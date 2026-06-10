// Morgan Stanley makes this available to you under the Apache License, Version 2.0 (the "License").
// You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0.
// See the NOTICE file distributed with this work for additional information regarding copyright ownership.
// Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and limitations under the License.

import { lastValueFrom } from 'rxjs';
import { getBackendSrv, type BackendSrv } from '@grafana/runtime';

import {
  ALL_SEVERITIES,
  AppDynamicsBusinessTransaction,
  AppDynamicsEntity,
  AppDynamicsEvent,
  AppDynamicsNode,
  DEFAULT_EVENT_TYPES,
  HealthRuleViolation,
  MetricSeries,
  MetricTreeItem,
} from '../types';

/**
 * Error thrown by {@link AppDynamicsClient} with a user-friendly message and,
 * when the controller responded, the HTTP status code.
 */
export class AppDynamicsApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AppDynamicsApiError';
    this.status = status;
  }
}

interface FetchErrorLike {
  status: number;
  statusText?: string;
  data?: unknown;
  message?: string;
}

function isFetchErrorLike(error: unknown): error is FetchErrorLike {
  return typeof error === 'object' && error !== null && typeof (error as FetchErrorLike).status === 'number';
}

/** Extracts the controller's own error text from a fetch error payload, if any. */
function controllerErrorText(data: unknown): string | undefined {
  if (typeof data === 'string' && data.trim().length > 0) {
    return data.trim();
  }
  if (typeof data === 'object' && data !== null) {
    const { message, error } = data as { message?: unknown; error?: unknown };
    if (typeof message === 'string' && message.trim().length > 0) {
      return message.trim();
    }
    if (typeof error === 'string' && error.trim().length > 0) {
      return error.trim();
    }
  }
  return undefined;
}

function normalizeError(error: unknown): AppDynamicsApiError {
  if (isFetchErrorLike(error)) {
    const detail = controllerErrorText(error.data) ?? error.statusText ?? error.message;
    const prefix = `AppDynamics request failed (HTTP ${error.status})`;
    return new AppDynamicsApiError(detail ? `${prefix}: ${detail}` : prefix, error.status);
  }
  if (error instanceof Error) {
    return new AppDynamicsApiError(`AppDynamics request failed: ${error.message}`);
  }
  return new AppDynamicsApiError(`AppDynamics request failed: ${String(error)}`);
}

/** The controller occasionally returns objects/strings on error paths; treat anything non-array as empty. */
function asArray<T>(payload: unknown): T[] {
  return Array.isArray(payload) ? (payload as T[]) : [];
}

/**
 * Thin typed wrapper around the AppDynamics controller REST API, reached
 * through the Grafana data source proxy (`baseUrl` = instance settings URL).
 */
export class AppDynamicsClient {
  private readonly baseUrl: string;
  private readonly backendSrv: BackendSrv;

  constructor(baseUrl: string, backendSrv: BackendSrv = getBackendSrv()) {
    this.baseUrl = baseUrl;
    this.backendSrv = backendSrv;
  }

  private async request<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    try {
      const response = await lastValueFrom(
        this.backendSrv.fetch<T>({
          url: `${this.baseUrl}${path}`,
          method: 'GET',
          params: { ...params, output: 'json' },
        })
      );
      return response.data;
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async getApplications(): Promise<AppDynamicsEntity[]> {
    return asArray(await this.request<unknown>('/controller/rest/applications'));
  }

  async getTiers(application: string): Promise<AppDynamicsEntity[]> {
    return asArray(
      await this.request<unknown>(`/controller/rest/applications/${encodeURIComponent(application)}/tiers`)
    );
  }

  async getNodes(application: string): Promise<AppDynamicsNode[]> {
    return asArray(
      await this.request<unknown>(`/controller/rest/applications/${encodeURIComponent(application)}/nodes`)
    );
  }

  async getBusinessTransactions(application: string): Promise<AppDynamicsBusinessTransaction[]> {
    return asArray(
      await this.request<unknown>(
        `/controller/rest/applications/${encodeURIComponent(application)}/business-transactions`
      )
    );
  }

  /** Lists the children of `parentPath` in the metric hierarchy; omit it to list the roots. */
  async browseMetrics(application: string, parentPath?: string): Promise<MetricTreeItem[]> {
    const params: Record<string, string> = {};
    if (parentPath !== undefined && parentPath !== '') {
      params['metric-path'] = parentPath;
    }
    return asArray(
      await this.request<unknown>(`/controller/rest/applications/${encodeURIComponent(application)}/metrics`, params)
    );
  }

  async getMetricData(
    application: string,
    metricPath: string,
    fromMs: number,
    toMs: number,
    rollup: boolean
  ): Promise<MetricSeries[]> {
    return asArray(
      await this.request<unknown>(`/controller/rest/applications/${encodeURIComponent(application)}/metric-data`, {
        'metric-path': metricPath,
        'time-range-type': 'BETWEEN_TIMES',
        'start-time': fromMs,
        'end-time': toMs,
        rollup: rollup ? 'true' : 'false',
      })
    );
  }

  /**
   * Fetches events. The controller requires both `event-types` and
   * `severities`; sensible defaults are applied when the caller passes none.
   */
  async getEvents(
    application: string,
    fromMs: number,
    toMs: number,
    eventTypes: string[],
    severities: string[]
  ): Promise<AppDynamicsEvent[]> {
    const types = eventTypes.length > 0 ? eventTypes : DEFAULT_EVENT_TYPES;
    const sevs = severities.length > 0 ? severities : ALL_SEVERITIES;
    return asArray(
      await this.request<unknown>(`/controller/rest/applications/${encodeURIComponent(application)}/events`, {
        'time-range-type': 'BETWEEN_TIMES',
        'start-time': fromMs,
        'end-time': toMs,
        'event-types': types.join(','),
        severities: sevs.join(','),
      })
    );
  }

  async getHealthRuleViolations(application: string, fromMs: number, toMs: number): Promise<HealthRuleViolation[]> {
    return asArray(
      await this.request<unknown>(
        `/controller/rest/applications/${encodeURIComponent(application)}/problems/healthrule-violations`,
        {
          'time-range-type': 'BETWEEN_TIMES',
          'start-time': fromMs,
          'end-time': toMs,
        }
      )
    );
  }
}
