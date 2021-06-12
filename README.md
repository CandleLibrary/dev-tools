# Candle Library Development Tools

This repo servers as the launch pad for developing Candle Library products. It can be used
to create project workspaces, maintain consistent versions amongst the various projects,
and publish working packages to repositories. 

A vscode plugin for working with candle repositories is also maintained in this repo.

## Installation

### NPM

```bash
$ npm install -g @candlelib/dev-tools
```

## Usage 

##### install-workspace
```bash
$ candle.lib install-workspace [--vscode] <path-to-workspace-directory>
```

##### version
```bash
$ candle.lib version [--dryrun] [...<candle-library-repo-name>]
```



## Commands

### `install-workspace`

The `candle.dev` `install-workspace` command  can be used to create a workspace directory for all Candle Library 
repositories on the local system. Once the workspace directory is created all Candle Library repositories
are cloned into the workspace, and appropriate links are created to resolve module imports. 

Other sub-commands target the repositories within this directory

### `version`

The `candle.dev` `version` command is able to create new version commits for any Candle Library repo 
(including `@candlelib/dev-tools`). This is achieved by explicitly versioning any `@candlelib/..` package
the target repo is using and recursively testing and versioning each `@candlelib` dependency until all 
`@candlelib` dependencies have a latest version. 

Should any dependency fail testing, the whole process is aborted and all actions are undone, leaving
all repositories unchanged.

#### Changelog

A change log may be created to track changes made since the last version commit for any repo. This is based
on the repo log messages, and may be skipped if this is not required. To opt into change log message, a commit
message must have the label `#changelog` on a single line. For example, should a commit be made with the following message:
```git
Feat: Demonstrate a commit with a change log entry

#changelog

Demonstrated a commit with a change log entry.  
```

the following section will be prepended to the `CHANGLOG.md` file when the repo is versioned:

> ## [v##.##.##] 
>
> - [Mon Jan ## ####] 
>    
>    Demonstrated a commit with a change log entry.

#### Version Signals

As `candle.dev` `version` scans commit messages to determine the state of the repo, it looks for 
certain keywords that indicate major and minor changes that can effect the how the next version
number is calculated. These keywords are case independent, and can be present anywhere within the
commit message.

- `Breaking | Breaks | Break | Deprecate` :  This will cause a major version increase over the 
    current major version. However, if the 
    the major version value is `0`, then the minor version number will instead
    be increased. 

    example:
    ```
    Break: Change method X interface to ...
    ---
    Breaking: Change module name to  ...

    ```
              
- `Feat | Feature` : This will cause, at minimum, a minor version increase
    
    example:
    
    ```
    Feat: Reduced method complexity and decreased processing time
    ---
    Feature: A
    ```

- `Fix | Correct | Change | Modify` : 
            This will cause, at minimum, a patch version increase

     ```
    Fix: Replace erroneous `==` expression with `=`
    ```

- `Refactor | Chore | Misc` :
            These changes should not break anything, and will only cause a patch version increase.
