# Contribution Guidelines for Grafana Appdynamics Plugin

We build Open Source software and we invite everyone to join us and contribute. So if you are interested into participate, please refer to the guidelines below.


## GIT Repositories

All code changes and submissions happens on [Github](http://github.com), that means that to start contributing you should clone the target repository, perform local changes and then do a Pull Request. For more details about the workflow we suggest you check the following documents:

 - https://help.github.com/articles/using-pull-requests
 - https://help.github.com/articles/creating-a-pull-request

## Coding Style

Our development coding style for TypeScript is based on the Apache C style guidelines, we use similar rules, to get more details about it please check the following URL:

 - https://github.com/airbnb/javascript

You have to pay attention to the code indentation, tabs are 2 spaces, spaces on conditionals, etc. If your code submission is not aligned, it will be rejected.

### General requirements

### Commit Changes

When you commit your local changes in your repository (before to push to Github), we need you take care of the following:

- [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)

### Line Length

Grafana Appdynamics Plugin source code lines length should not exceed 100 characters.

### Functions and nested levels

If your function is too long where many nested levels exists, consider to split your function in different ones and declare the spitted parts as static functions if they don't be intended to be called out of the scope of the source code file in question.

## Licensing

[Grafana Appdynamics Datasource](https://github.com/morganstanley/Plug-in-AppDynamics-Data-Source) is an Open Source project and all it code base _must_ be under the terms of the [Apache License v2.0](http://www.apache.org/licenses/LICENSE-2.0). When submitting changes to the core or any new plugin, you agreed to share that code under the license mentioned. All your source code files must have the following header:

```
// Morgan Stanley makes this available to you under the Apache License, Version 2.0 (the "License"). 
// You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0. 
// See the NOTICE file distributed with this work for additional information regarding copyright ownership.
// Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and limitations under the License.
```

Despite some licenses can be compatible with Apache, we want to keep things easy and clear avoiding a mix of Licenses across the project.

## Code review, no feelings

When we review your code submission, they must follow our coding style, the code should be clear enough, documented if required and the patch Subject and Description well formed (within others).

If your code needs some improvement, someone of the reviewers or core developers will write a comment in your Pull Request, so please take in count the suggestion there, otherwise your request will never be merged.

Despite the effort that took for you to create the contribution, that is not an indication that the code have to be merged into upstream, everything will be reviewed and must be aligned as the code base.