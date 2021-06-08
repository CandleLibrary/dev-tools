# Candle Library Development Tools

This repo servers as the launch pad for developing Candle Library products. It can be used
to create project workspaces, maintain consistent versions amongst the various projects,
and publish working packages to repositories. 

It also maintains a vscode plugin for working with candle products

## Installation

### NPM

```bash
$ npm install -g @candlelib/dev-tools
```

## Versioning

The dev tools is able to create new version commits for any Candle Library repo (including dev-tools).
This is achieved by explicitly versioning any @candlelib packages the target repo is using and recursively
testing and versioning each dependency until all dependencies have a latest version. Should any dependency
fail testing, the whole process is aborted and all actions are unwound.

A change log may be created to track changes made since the last version commit for any repo. This is based
on the repo log messages, and may be skipped if this is not required.

The versioning can occur on one of three channels: release, beta, and experimental

- `#Breaking` : If this is found any where within the commit message
              then this change will represent a breaking change. 
              At minimum this will cause a major version increase.
              
- Feat | Feature : This will cause at minimum a minor version increase

- Fix | Correct | Change | Modify : 
            This will cause at minimum a patch version increase

- Refactor | Chore | Misc :
            These changes should not break anything, and will only
            cause a patch version increase.

## Publishing


## Dev Environment

All Candle Library projects (including dev-tools) follow the same pattens for file structure, Typescript compilation, .gitignore parameters, .npmignore parameters, and building and testing configurations.

Source file layout
```
-- root # Core configuration files including
    -- 
```

CANDLE_ENV
    WORKSPACE_DIR