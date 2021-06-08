#! /usr/bin/node

import { getProcessArgs } from "@candlelib/wax";

const project_directory = getProcessArgs().trailing_arguments[0];