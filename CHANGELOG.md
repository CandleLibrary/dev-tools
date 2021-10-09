## [v0.6.1] - 2021-10-09 

- [2021-10-09]

    Made `#changelog` header search case-insensitive.  Added @candlelib/log for improved CLI messages.

- [2021-06-17]

    Added more verbose terminal output when versioning

## [v0.6.0] - 2021-06-17 

- [2021-06-17]

    Added version git tags to version sub-command. Also added publish.bounty files to packages that have been sucessfully versioned. When executed, these script files will automatically publish the package to NPM and then self destruct, allowing them to server as markers for packages that have yet to be published.  Added publish sub-command which utilizes the publish.bounty scripts to publish any packages that are pending.

## [v0.5.1] - 2021-06-12 

- [2021-06-12]

    Changed signal lookup behavior to only look for signals (Feature | Breaking | etc) at start of commit message.

- [2021-06-12]

    Changed date-timestamp for version headers in CHANGELOG updates to just use date portion

## [v0.5.0] - 2021-06-12T19:48:11.000Z 

- [2021-06-12]

    Added `--vscode` argument to `install-workspace` sub-command. When this argument is specified, a *.code-workspace file is created at the root of the workspace directory

## [v0.4.0] - 2021-06-12T18:29:33.000Z 

- [2021-06-12]

    Changed CHANGELOG.md time stamps to ISO 8601. Added timestamps to version headers.

- [2021-06-12]

    Added information for the `install-workspace` sub-command to the readme.

## [v0.3.0] 

- [Sat Jun 12 2021]

    Added dryrun argument for version command

- [Sat Jun 12 2021]

    Added default change log entry for new CHANGELOG.md files

- [Tue Jun 08 2021]

    Moved the workspace installation logic to JavaScript and added sub-command to CLI to install workspace in directory specified in command line arg.

## [v0.2.0] 

- [Tue Jun 08 2021]

    Changed dependency @candlelib/wax to @candlelib/paraffin. Now using paraffin to handle CLI process arguments through the new command path interface.

## [v0.1.0] 

- [Mon Jun 07 2021]

    Added scripts for initializing new CandleLibrary workspaces and versioning CandleLibrary repos.

- [Mon Jun 07 2021]

    Updated README.md with preliminary usage information

