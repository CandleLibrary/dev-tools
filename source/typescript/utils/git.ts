import child_process from "child_process";

export function gitStatus(CWD: string) {
    try {
        return child_process.execSync(`git status -s --column`,
            { cwd: CWD }
        ).toString();
    } catch (e) {
        console.error(e);
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
        console.error(e);
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
        console.log(e);
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
        console.error(e);
        return false;
    }
}

