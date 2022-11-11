// lxml-based SDEF parser

'use strict';

const fs = require('fs');

const libxml = require('libxmljs2');
const objc = require('objc');

const kDefaultTerminology = require('./aedefaultterminology');
const aesupport = require('./aesupport');
const aeerrors = require('./aeerrors');
const kae = require('./kae');


/****************************************************************************************/
// reserved attribute/parameter names


const reservedNames = [ // see aeselectors
  'at', 'named', 'ID', 'previous', 'next', 'slice', 'thru', 'where',
  'first', 'middle', 'last', 'any', 'every', 'beginning', 'end', 'before', 'after',
  'lt', 'le', 'eq', 'ne', 'gt', 'ge', 'beginsWith', 'endsWith', 'contains', 'isIn', 'and', 'or', 'not',
  'customRoot', 'launch', 'isRunning', 'property', 'elements', 'sendAppleEvent', 'help',
  'asType', 'sendOptions', 'withTimeout', 'ignoring', // command attributes
  'toString', 'valueOf', 'constructor', 'isSpecifier', 'isKeyword',
  'fromTypeCode', 'fromEnumCode', // raw Keyword constructors
];


/****************************************************************************************/
// support functions used by SDEFParser

function toFourCharCode(string) { // String -> OSType
  try {
    let code = 0;
    for (let i = 0; i < 4; i++) {
      code *= 256;
      const c = string.charCodeAt(i);
      if (c < 0x20 || c > 0x7e) { throw new Error('code is not 4 printable ASCII chars'); }
      code += c;
    }
    return code;
  } catch (_) { // use slow MacRoman-aware conversion as fallback
    const data = objc.ns(string).dataUsingEncoding_(30); // NSMacOSRomanStringEncoding = 30
    if (!data) {
      throw new aeerrors.TerminologyError(`invalid four-char code (bad encoding): "${string}"`);
    }
    if (data.length() !== 4) {
      throw new aeerrors.TerminologyError(`invalid four-char code (wrong length): "${string}"`);
    }
    const tmp = Buffer.alloc(4);
    data.getBytes_length_(tmp, 4);
    return tmp.readInt32BE();
  }
}

const _convertedNameCache = Object.create(null); // speed up converting keywords that appear repeatedly

function convertNameToIdentifier(name, isParameter) {
  let identifier = _convertedNameCache[name];
  if (identifier === undefined) {
    identifier = name.trim().replace(/\s+./g, function(s) { return s.substr(-1).toUpperCase(); });
    if (!isParameter && reservedNames.includes(identifier)) { identifier = escapeIdentifier(identifier); }
    _convertedNameCache[name] = identifier;
  }
  return identifier;
}

function escapeIdentifier(identifier) {
  return `${identifier}_`;
}


const _inspectOptions = {maxArrayLength:null, depth:null};


/****************************************************************************************/
// SDEF parser


class SDEFParser {
  
  constructor() {
    // SDEF names and codes are parsed into the following tables
    this.types = []; // [[NAME,CODE],...]
    this.enumerators = [];
    this.properties = [];
    this.elements = [];
    this.commands = []; // [{name:NAME,eventClass:CODE,eventID:CODE,params:{NAME:CODE,...}}
    this._commandsDict = {}; // command defs by name; used to disambiguate duplicate command definitions
    this._defaultElementsByCode = {}; // may be used if a 'class' element doesn't have 'plural' attribute
    for (let element of kDefaultTerminology.elements) { // name,code
      this._defaultElementsByCode[element[1]] = element[0];
    }
  }
  
  // extract name and code attributes from a class/enumerator/command/etc XML element
  
  parseKeywordElement(element) { // XMLElement -> [String, OSType]
    const name = element.attr("name")?.value();
    const code = element.attr("code")?.value();
    if (!(name && code)) { throw new aeerrors.TerminologyError("missing 'name'/'code' attribute."); }  
    // parse an OSType given as 4/8-character "MacRoman" string, or 10-character hex string
    // e.g. 'ABCD' -> OSType, "0x1234ABCD" -> OSType
    return [name, (code.length === 4) ? toFourCharCode(code) : aesupport.UInt32(code)];
  }
  
  parseCommandElement(element) { // XMLElement -> [String, OSType, OSType]
    const name = element.attr("name")?.value();
    const code = element.attr("code")?.value();
    if (!(name && code)) { throw new aeerrors.TerminologyError("missing 'name'/'code' attribute."); }
    let eventClass, eventID;
    if (code.length === 8) { // e.g. "corecrel"
      eventClass = toFourCharCode(code.substring(0,4));
      eventID = toFourCharCode(code.substring(4));
    } else { // e.g. "0x1234567890ABCDEF"
      eventClass = aesupport.UInt32(string.substring(0,10));
      eventID = aesupport.UInt32('0x'+string.substring(10));
    }
    return [name, eventClass, eventID];
  }
  
  //
  
  parseTypeOfElement(element) { // XMLElement -> [String, OSType] // class, record-type, value-type
    const [name, code] = this.parseKeywordElement(element);
    this.types.push([convertNameToIdentifier(name), code]);
    return [name, code];
  }
  
  parsePropertiesOfElement(element) { // XMLElement // class, class-extension, record-value
    for (let node of element.find("property")) {
      const [name, code] = this.parseKeywordElement(node);
      this.properties.push([convertNameToIdentifier(name), code]);
    }
  }
  
  // parse a class/enumerator/command/etc element of a dictionary suite
  
  parseDefinition(element) { // XMLNode
    //console.log('parseDefinition: ' + element.name())
    switch (element.name()) {
    case "class":
    {
      const [name, code] = this.parseTypeOfElement(element);
      this.parsePropertiesOfElement(element);
      // use plural class name as elements name (if not given, append "s" to singular name)
      // (note: record and value types also define plurals, but we only use plurals for element names and elements should always be classes, so we ignore those)
      const plural = element.attr("plural");
      let tmp;
      if (plural) {
        tmp = plural.value();
      } else if (this._defaultElementsByCode[code] !== undefined) {
        // default terminology already defines 'items' and 'text' as known element names
        tmp = this._defaultElementsByCode[code];
      } else {
        // note: the spec says to append 's' to name when plural attribute isn't given; in practice, appending 's' doesn't work so well for names already ending in 's' (e.g. 'print settings'), which is really the SDEF's problem; for now we'll omit the second 's' and hope that doesn't confuse with property name
        tmp = name.endsWith('s') ? name : `${name}s`;
      }
      const pluralName = convertNameToIdentifier(tmp);
      this.elements.push([pluralName, code]);
      break;
    }
    case "class-extension":
      this.parsePropertiesOfElement(element);
      break;
    case "record-type":
      this.parseTypeOfElement(element);
      this.parsePropertiesOfElement(element);
      break;
    case "value-type":
      this.parseTypeOfElement(element);
      break;
    case "enumeration":
      for (let node of element.find("enumerator")) {
        const [name, code] = this.parseKeywordElement(node);
        this.enumerators.push([convertNameToIdentifier(name), code]);
      }
      break;
    case "command":
    case "event":
    {
      const [name, eventClass, eventID] = this.parseCommandElement(element);
      // Note: overlapping command definitions (e.g. 'path to') should be processed as follows:
      // - If their names and codes are the same, only the last definition is used; other definitions are ignored
      //   and will not compile.
      // - If their names are the same but their codes are different, only the first definition is used; other
      //   definitions are ignored and will not compile.
      const previousDef = this._commandsDict[name];
      if (previousDef === undefined || (previousDef.eventClass === eventClass && previousDef.eventID === eventID)) {
        const command = {name: convertNameToIdentifier(name), eventClass: eventClass, eventID: eventID, params: {}};
        this._commandsDict[name] = command;
        for (let node of element.find("parameter")) {
          const [name, code] = this.parseKeywordElement(node);
          command.params[convertNameToIdentifier(name, true)] = code;
        }
      } // else ignore duplicate declaration
      break;
    }
    }
  }
  
  // parse the given SDEF XML data into this object's types, enumerators, properties, elements, and commands arrays
  
  parse(sdef) { // Buffer
    if (!(sdef instanceof Buffer)) {
      if (!(objc.isInstance(sdef) && sdef.isKindOfClass_(objc.NSData))) {
        throw new TypeError(`Expected Buffer or NSData, got ${typeof sdef}: ${util.inspect(sdef)}`);
      }
      // kludge; we should be able to get -[NSData bytes], but that currently returns a useless Ref object
      const buffer = Buffer.alloc(sdef.length());
      sdef.getBytes_length_(buffer, sdef.length());
      //console.log(buffer);
      sdef = buffer;
    }
    let dictionary;
    try {
      dictionary = libxml.parseXmlString(sdef, {xinclude: true}).root();
    } catch (e) {
      throw new aeerrors.TerminologyError(`can't parse SDEF XML: ${e}`);
    }
    const parseDefinition = this.parseDefinition;
    for (let node of dictionary.find("suite/*")) {
      this.parseDefinition(node);
    }
    for (let k in this._commandsDict) { this.commands.push(this._commandsDict[k]); }
  }
}


/****************************************************************************************/


module.exports.SDEFParser = SDEFParser;

