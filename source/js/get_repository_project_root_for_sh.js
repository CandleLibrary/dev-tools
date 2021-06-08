#! /usr/bin/node

import { getPackageJsonObject } from "@candlelib/wax";

const print = console.log;

const { package: pkg } = await getPackageJsonObject();

const root = pkg["candle-env"]["repo-root"];

print(root);

export { root as repo_root };