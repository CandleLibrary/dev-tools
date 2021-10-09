import {
    createDepend,
    getCandlePackage,
    getPackageDependencies,
    getWorkspaceEnvironmentVar,
    testPackage
} from "../build/library/utils/version-sys.js";


assert_group("Basic utility functions", sequence, () => {

    assert("CANDLE_ENV file present", (await getWorkspaceEnvironmentVar()) + "" !== null);

    assert("WORKSPACE_DIR environment variable present", (await getWorkspaceEnvironmentVar()).WORKSPACE_DIR != undefined);

    const root_path = (await getWorkspaceEnvironmentVar()).WORKSPACE_DIR;

    assert((await getCandlePackage("wick")).name == "@candlelib/wick");

    assert((await getCandlePackage("@candlelib/wick")).name == "@candlelib/wick");

    assert((await getCandlePackage("hydrocarbon")).name == "@candlelib/hydrocarbon");

    assert((await getCandlePackage("@candlelib/hydrocarbon")).name == "@candlelib/hydrocarbon");

    assert((await getCandlePackage("conflagrate")).name == "@candlelib/conflagrate");

    assert((await getCandlePackage("@candlelib/conflagrate")).name == "@candlelib/conflagrate");

    assert((await getCandlePackage("js")).name == "@candlelib/js");

    assert((await getCandlePackage("@candlelib/js")).name == "@candlelib/js");

    assert((await getCandlePackage("spark")).name == "@candlelib/spark");

    assert((await getCandlePackage("@candlelib/spark")).name == "@candlelib/spark");

});


assert_group("Run tests", 200000, sequence, skip, () => {

    const package = await getCandlePackage("wind");
    const result = await testPackage(package);
    assert("Expect wind test process to exit cleanly", result == true);

});


assert_group("Trace Dependencies", 200000, sequence, () => {
    const package = await getCandlePackage("js");
    const dep = await createDepend(package);
    const result = await getPackageDependencies(dep);

    assert("Retrieves recursive package dependency list for @candlelib/js", result.size == 12);
    assert("Recursive package dependency list include @candlelib/hydrocarbon", result.has("@candlelib/hydrocarbon") == true);
    assert("Recursive package dependency list include @candlelib/conflagrate", result.has("@candlelib/conflagrate") == true);
    assert("Recursive package dependency list include @candlelib/uri", result.has("@candlelib/uri") == true);
    assert("Recursive package dependency list include @candlelib/wind", result.has("@candlelib/wind") == true);
    assert("Recursive package dependency list include @candlelib/js", result.has("@candlelib/js") == true);
});

/*
assert_group("Verify Versioning Eligibility", 200000, sequence, () => {

    const repo_name = "html";

    const dep = await createDepend(await getCandlePackage(repo_name));

    assert(await validateEligibility(dep) == 1);
});
*/
