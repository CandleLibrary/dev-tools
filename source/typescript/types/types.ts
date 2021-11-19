import { PackageJSONData } from "@candlelib/paraffin";
export const enum TestStatus {
    NOT_RUN = 0,
    PASSED = 1,
    FAILED = -1
}

export type CommitLog = {
    hash: string;
    date: string;
    author: string;
    message: string;
};


export interface Dependency {
    name: string;
    package: DevPkg;
    TEST_STATUS: TestStatus;
    reference_count: number;
    new_version: string;
    current_version: string;

    /**
     * Array of commit messages in the repo.
     */
    commits: CommitLog[];

    /**
     * True if there are uncommitted changes
     * in the repo.
     */
    DIRTY_REPO: boolean;

    /**
     * True if the system has already processed
     * this dependency in a previous pass
     */
    PROCESSED: boolean;

    version_data: {
        new_version: string;
        git_version: string;
        pkg_version: string;
        latest_version: string;
        NEW_VERSION_REQUIRED: boolean;
    };
}


export type Dependencies = Map<string, Dependency>;
/**
 * package.json object modified with the location of the dev-tools
 * directory
 */

export type DevPkg = PackageJSONData & { _workspace_location: string; };


export type Version = {
    sym: number[];
    channel: string;
};