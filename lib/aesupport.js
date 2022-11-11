// support classes and functions

'use strict';

const util = require('util');

const objc = require('objc');

const kae = require('./kae');


const __packSelf        = Symbol('__packSelf');
const __specifierRecord = Symbol('__specifierRecord');
const __appData         = Symbol('__appData');


/****************************************************************************************/
// utility functions

function isBoolean(object) { return (typeof object === 'boolean' || object instanceof Boolean); }
function isNumber(object)  { return (typeof object === 'number'  || object instanceof Number);  }
function isString(object)  { return (typeof object === 'string'  || object instanceof String);  }


const SINT32_MIN = -Math.pow(2, 31);
const SINT32_MAX = Math.pow(2, 31) - 1;
const UINT32_MAX = Math.pow(2, 32) - 1;


function convertZeroToOneIndex(num) {
  const n = Number(num);
  if (n % 1 !== 0 || n < SINT32_MIN || n >= SINT32_MAX) { throw new TypeError(`Not a 32-bit integer: "${num}"`); }
  return n < 0 ? n : n + 1;
}

function SInt32(num) {
  const n = Number(num);
  if (n % 1 !== 0 || n < SINT32_MIN || n > SINT32_MAX) { throw new TypeError(`Not a 32-bit integer: "${num}"`); }
  return n;
}

function UInt32(num) {
  const n = Number(num);
  if (n % 1 !== 0 || n < 0 || n > UINT32_MAX) { throw new TypeError(`Not a 32-bit unsigned integer: "${num}"`); }
  return n;
}


class AEOpaqueDescriptor {
  // an AEDesc analog that can pack itself into an AEDescriptorBuffer
  
  constructor(type, data = null) {
    // type : UInt32 | Buffer -- a descriptorType, or a buffer containing a complete descriptor
    // data : Buffer | null -- if a descriptorType is given, the pre-flattened descriptor data, if any
    // note: the descriptor buffer should not contain a 'dle2' header
    if (type instanceof Buffer) {
      this.type = type.readUInt32BE(0);
      this.size = type.length;
      this[__packSelf] = function packDescriptorBuffer(aeBuffer) {
        aeBuffer.writeBuffer(type);
      };
      this[Symbol.toPrimitive] = function(hint) {
        return `<${formatFourCharCode(this.type)} ${type.toString('hex')}>`;
      };
    } else if (data instanceof Buffer) {
      this.type = type;
      this.size = 8 + data.length;
      this[__packSelf] = function packDescriptorTypeWithData(aeBuffer) {
        aeBuffer.writeUInt32BE(type);
        aeBuffer.writeUInt32BE(data.length);
        aeBuffer.writeBuffer(data);
      };
      this[Symbol.toPrimitive] = function(hint) {
        return `<${formatFourCharCode(this.type)}[${this.size}]=${this.type.toString(16).padStart(8, '0')}${type.toString('hex', 4)}>`;
      };
    } else if (data === null) {
      this.type = type;
      this.size = 8;
      this[__packSelf] = function packDescriptorType(aeBuffer) {
        aeBuffer.writeUInt32BE(type);
        aeBuffer.writeUInt32BE(0);
      };
      this[Symbol.toPrimitive] = function(hint) {
        return `<${formatFourCharCode(this.type)}[0]>`;
      };
    } else {
      throw new TypeError(`AEOpaqueDescriptor expected Buffer or null data, got ${typeof data}`);
    }
  }
  
  [util.inspect.custom]() { return `[AEOpaqueDescriptor ${formatFourCharLiteral(this.type)}]`; }
}


function isNSAppleEventDescriptor(value) {
  try {
    return (objc.isInstance(value) && value.isKindOfClass_(objc.NSAppleEventDescriptor));
  } catch(e) {
    return false;
  }
}


function parseFourCharCode(code) { // accept '#CCCC', '0xXXXXXXXX', Number; return UInt32
  if (isString(code) && code.match(/^#[\x20-\x7E]{4}$/) !== null) {
    return (code.charCodeAt(1) << 24) | (code.charCodeAt(2) << 16) | (code.charCodeAt(3) << 8) | code.charCodeAt(4);
  } else {
    return UInt32(code); // accept 32-bit uint; hex strings, e.g. "0x1234ABCD" are also acceptable (e.g. object key)
  }
}

function formatFourCharCode(code) { // format UInt32 as four-char code (note: to get JS literal representation, use formatFourCharLiteral)
  let num = Number(code);
  if (num % 1 !== 0 || num < 0 || num > UINT32_MAX) { return `<BUG: expected OSType, got ${typeof code}: ${util.inspect(code)}>`; } //{ throw new TypeError(`Not an OSType: ${num}`); }
  let result = '#'; // '#abcd' four-char code (printable ASCII) is preferred; else UInt32 '0x123456EF'
  for (let rs of [24, 16, 8, 0]) {
    const n = (num >> rs) % 256;
    if (n >= 0x20 && n < 0x7f && n !== 34 && n !== 92) { // build printable ASCII string representation (backslash and double quote chars are also excluded to simplify formatting the result as a string literal)
      result += String.fromCharCode(n);
    } else { // discard and return hexadecimal representation
      return '0x' + (`00000000${parseInt(num, 16)}`.slice(-8));
    }
  }
  return result;
}

function formatFourCharLiteral(num) { // format UInt32 as a JS literal (hex number or quoted string)
  const s = formatFourCharCode(num);
  return s.startsWith('#') ? `'${s}'` : s;
}


function fileURLForLocalApplication(name) { // String -> NSURL/null
  // note: relative paths are not supported; `name` must be absolute path or file name only
  if (name.startsWith("/")) { // absolute path to app bundle (note: full path must include .app suffix)
    return objc.NSURL.fileURLWithPath_(name);
  } else { // if only app's name is given, locate app bundle via Launch Services (.app suffix is optional)
    const workspace = objc.NSWorkspace.sharedWorkspace();
    let path = workspace.fullPathForApplication_(name);
    if (!path && !name.toLowerCase().endsWith('.app')) {
      path = workspace.fullPathForApplication_(`${name}.app`);
    }
    return (path ? objc.NSURL.fileURLWithPath_(path) : null);
  }
}


/****************************************************************************************/
// AEDescs used in constructing object specifiers

// AEM doesn't support these query forms directly, so define custom codes here and translate to supported forms on pack
const kAENotEquals = 1;
const kAEIsIn = 2;


/****************************************************************************************/
// additional types

// keyword, e.g. k.UnicodeText, k.fromTypeCode(0x75747874)

class Keyword {
  #type; #name;
  
  // constructors
  static fromTypeCode(code) { return new Keyword(code, kae.typeType); }
  static fromEnumCode(code) { return new Keyword(code, kae.typeEnumerated); }

  constructor (name, type = kae.typeType) {
    // name : string | UInt32 -- usually string (e.g. 'document', 'ask', '#docu'), but may be UInt32
    if (isString(name) && '#0123456789'.includes(name[0])) { // four-char code string
      name = parseFourCharCode(name);
    }
    if (isNumber(name)) {
      this[__packSelf] = function(aeBuffer, appData) {
        aeBuffer.writeUInt32BE(type);
        aeBuffer.writeUInt32BE(4);
        aeBuffer.writeUInt32BE(name);
      };
    } else {
      this[__packSelf] = function(aeBuffer, appData) {
        const definition = appData.typeCodeForName(name);
        if (definition === undefined) { throw new Error(`Unknown type/enum: k.${name}`); }
        aeBuffer.writeUInt32BE(definition.type);
        aeBuffer.writeUInt32BE(4);
        aeBuffer.writeUInt32BE(definition.code);
      };
    }
    this.#type = type;
    this.#name = name;
  }
  
  get type() { return this.#type; }
  get name() { return this.#name; } // TO DO: rename `value`? (since it can be string or integer)
  
  [Symbol.toString]() {
    if (isString(this.#name)) {
      return `k.${this.#name}`;
    } else if (this.#type === kae.typeEnumerated) {
      return `k.fromEnumCode(${formatFourCharLiteral(this.#name)})`;
    } else if (this.#type === kae.typeType) {
      return `k.fromTypeCode(${formatFourCharLiteral(this.#name)})`;
    } else {
      return `Keyword('${formatFourCharCode(this.#name)}', '${formatFourCharCode(this.#type)}')`;
    }
  }
  
  [Symbol.toPrimitive](hint) {
    return isNumber(hint) ? Number.NaN : this[Symbol.toString](); // we *could* return the code, but is that really appropriate? (while it is a UInt32, it is symbolic, not numeric; whereas toPrimitive(number) is most likely to be called when JS is coercing an arithmetic operand, in which case the proper response is to fail, or at least return something obviously not-a-number)
  }
  
  [util.inspect.custom]() { return this[Symbol.toString](); }
  
  isEqual(value) { return value instanceof Keyword && this.#name === value.name; }
  
  static isKeyword(value) { return value instanceof Keyword; }
}


// file system identifiers


class File {
  #path; #fileURL; #urlString;
  
  // TO DO: use AEOpaqueDescriptor in public APIs
  
  // TO DO: should File encapsulate typeFileURL/typeAlias/typeBookmarkData/typeFSRef descriptors?
  
  static fromHFSPath(hfsPath) {
    if (!isString(hfsPath)) {
      throw new TypeError(`Invalid path argument for File.fromHFSPath constructor: ${util.inspect(hfsPath)}`);
    }
    const desc = objc.NSAppleEventDescriptor.descriptorWithString_(hfsPath)
                        .coerceToDescriptorType_(kae.typeFileURL);
    if (!desc) {
      throw new TypeError(`Invalid path argument for File.fromHFSPath(...) constructor: ${util.inspect(hfsPath)}`);
    }
    return new File(objc.js(desc.fileURLValue()));
  }
  
  constructor(path) {
    // TO DO: also accept descriptor
    if (this === undefined) { throw new TypeError("Missing 'new' for 'File' constructor."); }
    if (!(isString(path) && path.startsWith('/'))) {
      throw new TypeError(`Bad argument for 'File' constructor (expected POSIX path string): ${util.inspect(path)}`);
    }
    this.#path = path;
    this.#fileURL = null;
    this.#urlString = null;
  }
  
  get path() { return this.#path; }
  
  get fileURL() { 
    if (this.#fileURL === null) {
      this.#fileURL = objc.NSURL.fileURLWithPath_(this.#path);
    }
    return this.#fileURL;
  }
  
  get _descriptor() {
    return objc.NSAppleEventDescriptor.descriptorWithFileURL_(this.fileURL);
  }
  
  [__packSelf](aeBuffer, appData) { 
    aeBuffer.writeUInt32BE(kae.typeFileURL);
    const sizeOffset = aeBuffer.allocate(4); // data size (TBC)
    if (this.#urlString === null) {
      this.#urlString = objc.js(this.fileURL.absoluteString());
    }
    const bytesWritten = aeBuffer.writeUTF8(this.#urlString); // write string, getting back its size in bytes
    aeBuffer.rawBuffer.writeUInt32BE(bytesWritten, sizeOffset); // write size
  }
  
  [Symbol.toPrimitive](hint) { return isNumber(hint) ? Number.NaN : this.#path; }
  
  [Symbol.toString]() { return this.#path; }
  
  [util.inspect.custom]() { return `(new File(${util.inspect(this.#path)}))`; };
  
  isEqual(value) { return value instanceof File && this.#path === value.path; }
  
  get aliasDescriptor() { // for compatibility with older apps that won't accept a typeFileURL descriptor
    return this._descriptor.coerceToDescriptorType_(kae.typeAlias); // TO DO: return as AEOpaqueDescriptor
  }
  
  toHFSPath() { // -> String
    return this._descriptor.coerceToDescriptorType_(kae.typeUnicodeText).stringValue(); // this shouldn't fail
  }
  
  static isFile(value) { return value instanceof File; }
}


function isAllElementsEnum(value) {
  return value instanceof Keyword && value.name === kae.kAEAll;
}


/****************************************************************************************/


module.exports.kae                        = kae; // re-export OSType constants as na.__aesupport.kae

// type checking
module.exports.isBoolean                  = isBoolean;
module.exports.isNumber                   = isNumber;
module.exports.isString                   = isString;
module.exports.isNSAppleEventDescriptor   = isNSAppleEventDescriptor;
module.exports.isAllElementsEnum          = isAllElementsEnum; // is `Keyword(kAEAll,typeEnumerated)`

// symbols (used as reserved attribute names on specifiers)
module.exports.__packSelf                 = __packSelf;
module.exports.__specifierRecord          = __specifierRecord;
module.exports.__appData                  = __appData;

// custom types
module.exports.AEOpaqueDescriptor         = AEOpaqueDescriptor;
module.exports.Keyword                    = Keyword;
module.exports.File                       = File;

// cast and bounds-check numbers
module.exports.SINT32_MIN                 = SINT32_MIN;
module.exports.SINT32_MAX                 = SINT32_MAX;
module.exports.SInt32                     = SInt32;
module.exports.UInt32                     = UInt32;

// convert four-char code strings (e.g. '#docu') to/from OSType, with bounds checking (uint32s are also accepted)
module.exports.parseFourCharCode          = parseFourCharCode;
module.exports.formatFourCharCode         = formatFourCharCode;
module.exports.formatFourCharLiteral      = formatFourCharLiteral;

// convert JS's ELEMENTS[...] and ELEMENTS.slice(...) indexes (zero-indexed) to AE element indexes (one-indexed)
module.exports.convertZeroToOneIndex      = convertZeroToOneIndex;
module.exports.fileURLForLocalApplication = fileURLForLocalApplication;

// no-value flags used in AppData.sendAppleEvent() and aeformatter.formatSpecifier()
module.exports.kNoParameter               = Symbol('kNoParameter');
module.exports.kSpecifierRoot             = Symbol('kSpecifierRoot');

// hide this module's content from REPL for readability
module.exports[util.inspect.custom]       = () => '[nodeautomation.__aesupport]';

