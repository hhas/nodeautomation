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



let v2  //= c.unpack(desc);

let b = Buffer.from('6c6f67690000012400000002000000006c6f6763656e756d000000044e4f54207465726d6c697374000001000000000100000000636d7064000000f0000000030000000072656c6f656e756d000000043d2020206f626a316f626a2000000088000000040000000077616e74747970650000000470726f70666f726d656e756d0000000470726f7073656c6474797065000000046169464366726f6d6f626a2000000044000000040000000077616e74747970650000000400000000666f726d656e756d00000004696e647873656c646c6f6e67000000040000000166726f6d65786d6e000000006f626a3274524769000000380000000300000000524544206c6f6e6700000004000000004752454e6c6f6e670000000400000000424c55456c6f6e670000000400000000', 'hex');
b.aeoffset = 0;
v2 = c._readDescriptor(b);

//console.log('UNPACKED:', aesupport.formatFourCharCode(v2))
console.log('UNPACKED:', (v2))

