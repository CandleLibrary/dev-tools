import child_process from "child_process";

export function gitStatus(CWD: string) {
    try {
        return child_process.execSync(`git status -s --column`,
            { cwd: CWD }
        ).toString();
    } catch (e) {
        console.error(e.toString());
        return "";
    }
}


export function gitLog(CWD: string) {
    try {
        return child_process.execSync(
            `git log --no-decorate`,
            { cwd: CWD }
        ).toString();
    } catch (e) {
        console.error(e.toString());
        return "";
    }
}

export function gitAdd(CWD: string, paths: string = "."): boolean {
    try {
        child_process.execSync(
            `git add ${paths}`,
            { cwd: CWD }
        );
        return true;
    } catch (e) {
        console.log(e.toString());
        return false; e;
    }
}


export function gitCommit(CWD: string, commit_message = ""): boolean {
    if (!commit_message)
        return false;

    try {

        child_process.execSync(
            `git commit -m "${commit_message}"`,
            { cwd: CWD }
        );
        return true;
    } catch (e) {
        console.error(e.toString());
        return false;
    }
}

export function gitCheckout(CWD: string, branch = ""): boolean {
    if (!branch)
        return false;

    try {

        child_process.execSync(
            `git checkout "${branch}"`,
            { cwd: CWD }
        );
        return true;
    } catch (e) {
        console.error(e.toString());
        return false;
    }
}

export function gitClone(remote_repo_url: string, CWD: string): boolean {
    if (!remote_repo_url)
        return false;

    try {

        child_process.execSync(
            `git clone "${remote_repo_url}"`,
            { cwd: CWD || "" }
        );
        return true;
    } catch (e) {
        console.error(e.toString());
        return false;
    }
}

export function gitPull(remote_repo_url: string, CWD: string): boolean {
    if (!remote_repo_url)
        return false;

    try {

        child_process.execSync(
            `git pull "${remote_repo_url}"`,
            { cwd: CWD || "" }
        );
        return true;
    } catch (e) {
        console.error(e.toString());
        return false;
    }
}

export function gitFetch(remote_repo_url: string, CWD: string): boolean {
    if (!remote_repo_url)
        return false;

    try {

        child_process.execSync(
            `git pull "${remote_repo_url}"`,
            { cwd: CWD || "" }
        );
        return true;
    } catch (e) {
        console.error(e.toString());
        return false;
    }
}