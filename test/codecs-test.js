#!/usr/bin/env node

const os = require('os');
const util = require('util');

const ffi = require('ffi-napi');
const ref = require('ref-napi');

const objc = require('objc');
objc.import('AppKit');
objc.import('/System/Library/Frameworks/Carbon.framework/Versions/A/Frameworks/OpenScripting.framework');

const kae = require('../lib/kae');
const aesupport = require('../lib/aesupport');

const aeappdata = require('../lib/aeappdata');

const {app, k, its} = require('../lib/index');


/******************************************************************************/
// TEST

//console.log('test');

const c = new aeappdata.AppData('currentApplication', null, {terminology: null});

const a = app.currentApplication();

let value = null;
value = true;
value = 2;
value = 'hello';
//value = new Date();
//value = [true, 2, -3.14, 'hello', new Date()];
//value = {'class': new Keyword(kae.cDocument), '0x66666666': 4, '0x55555555': 3};
//value = {'#pnam': new Keyword(kae.cDocument), '0x66666666': 4, '0x55555555': 3};
//value = new aesupport.File('/Users/has').aliasDescriptor;

//value = a.elements('#docu')[0].property(kae.cText)

//value = k.fromTypeCode('#docu')

//value = its.property('#pnam').contains(' ')

value = [k.case, k.numericStrings]

console.log('PACKING:',value);
let desc = c.pack(value);

console.log('PACKED:', aesupport.formatFourCharCode(desc.descriptorType()), desc);

let v2  = c.unpack(desc);

//console.log('UNPACKED:', aesupport.formatFourCharCode(v2))
console.log('UNPACKED:', (v2))

