#!/usr/bin/env node

var $ = require('NodObjC');

// import the "Foundation" framework and its dependencies
$.import('Foundation');

// create the mandatory NSAutoreleasePool instance
var pool = $.NSAutoreleasePool('alloc')('init');




pool('release');

