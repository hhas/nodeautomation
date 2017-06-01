#!/usr/bin/env node

'use strict';

const objc = require('NodObjC');
objc.import('Foundation');
objc.import('AppKit');
objc.import('Carbon');

module.exports = objc;

