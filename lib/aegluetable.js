#!/usr/bin/env node

'use strict';

// aegluetable


// TO DO: `ascrgsdf` handler is buggy in apps that don't include native .sdef file, e.g. TextEdit throws 'resource not found' error -192 instead of generating sdef. Could file a Radar, but probably not worth it as Apple don't appear to care about Automation anyway.

const objc = require('./objc');

const kDefaultTerminology = require('./aedefaultterminology');
const aeerrors = require('./aeerrors');


const kVersion = "1.0";


/****************************************************************************************/
// reserved attribute/parameter names


const reservedNames = [ // see aeselectors
        'at', 'named', 'ID', 'previous', 'next', 'slice', 'thru', 'where',
        'first', 'middle', 'last', 'any', 'all', 'beginning', 'end', 'before', 'after',
        'lessThan', 'lessOrEqual', 'equalTo', 'notEqualTo', 'greaterThan', 'greaterOrEqual',
        'beginsWith', 'endsWith', 'contains', 'isIn', 'and', 'or', 'not',
        'customRoot', 'launch', 'isRunning', 'property', 'elements', 'sendAppleEvent', 'help',
        'asType', 'sendOptions', 'withTimeout', 'ignoring', // command attributes
        'toString', 'valueOf', 'constructor', 'isSpecifier', 'isKeyword',
];


/****************************************************************************************/
// support functions


function toEightCharCode(eventClass, eventID) {
    return `${eventClass}/${eventID}`;
}

// get application terminology in SDEF format

function getScriptingDefinition(url) { // NSURL -> NSData
    const sdef = objc.alloc('pointer').ref();
    const err = objc.OSACopyScriptingDefinitionFromURL(url.pointer, 0, sdef);
    if (err !== 0) { // note: if -192 (resource not found), app is 'non-scriptable' so use default terms only
        throw new aeerrors.TerminologyError(`can't get SDEF from ${url}`, err);
    }
    return objc.CFBridgingRelease(sdef.deref());
}


// support functions used by SDEFParser

function toFourCharCode(string) { // String -> OSType
    const data = objc(string)('dataUsingEncoding', 30); // NSMacOSRomanStringEncoding = 30
    if (data === null) {
        throw new aeerrors.TerminologyError(`invalid four-char code (bad encoding): "${string}"`);
    }
    if (data('length') !== 4) {
        throw new aeerrors.TerminologyError(`invalid four-char code (wrong length): "${string}"`);
    }
    var tmp = Buffer(4);
    data('getBytes', tmp, 'length', 4);
    return tmp.readInt32BE();
}

var _convertedNameCache = {}; // trade memory for speed when converting keywords that appear repeatedly

function convertNameToIdentifier(name) {
    name = name.toString();
    var identifier = _convertedNameCache[name];
    if (identifier === undefined) {
        identifier = name.trim().replace(/\s+./g, function(s) { return s.substr(-1).toUpperCase(); });
        if (reservedNames.includes(identifier)) { identifier = escapeIdentifier(identifier); }
        // TO DO: what about replacing non-alphanumeric chars? what about names that start with double underscores?
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

// TO DO: SDEFParser is extremely slow on very large SDEFs, in part due to nodobjc overheads; move objc() conversions of JS string literals to global consts; try to avoid crossing JS-ObjC bridge as much as possible (e.g. consider using NSString APIs in parseFourCharCode, etc.)


function SDEFParser() {    
    // SDEF names and codes are parsed into the following tables
    this.types = []; // [[NAME,CODE],...]
    this.enumerators = [];
    this.properties = [];
    this.elements = [];
    this.commands = []; // [{name:NAME,eventClass:CODE,eventID:CODE,params:{NAME,CODE,...}}
    
    this._commandsDict = {}; // command defs by name; used to disambiguate duplicate command definitions
    
    this._defaultElementsByCode = {}; // may be used if a 'class' element doesn't have 'plural' attribute
    for (var element of kDefaultTerminology.elements) { // name,code
        this._defaultElementsByCode[element[1]] = element[0];
    }
    
    this.inspect = function() { // TO DO: improve this (show codes has hex, show command params)
        const util = require('util');
        return util.inspect({types:this.types, enumerators:this.enumerators, properties:this.properties,
                                            elements:this.elements, commands:this.commands}, _inspectOptions);
    }
    
    // parse an OSType given as 4/8-character "MacRoman" string, or 10/18-character hex string
    
    this.parseFourCharCode = function(string) { // [NS]String -> OSType; class, property, enum, param, etc. code; 
        string = string.toString();
        if (string.match(/^0[xX][0-9a-fA-F]{8}/)) { // e.g. "0x1234ABCD" -> OSType
            return aesupport.UInt32(string); // throws if invalid
        } else {
            return toFourCharCode(string); // e.g. 'ABCD' -> OSType
        }
    }
    
    this.parseEightCharCode = function(string) { // [NS]String -> [OSType, OSType] // eventClass and eventID code
        string = string.toString();
        if (string.match(/^0[xX][0-9a-fA-F]{18}/)) { // e.g. "0x1234567890ABCDEF" -> OSType
            return [aesupport.UInt32(string.substring(0,10)), aesupport.UInt32('0x'+string.substring(10))];
        } else {
            return [toFourCharCode(string.substring(0,4)), toFourCharCode(string.substring(4))];
        }
        //  "Invalid eight-char code (wrong length): \((string as String).debugDescription)"
    }
    
    //
    
    this.iter = function(nsarray, func) {
        for (var i = 0; i < nsarray('count'); i++) {
            try {
                func.call(this, nsarray('objectAtIndex', i));
            } catch (e) {
                console.log(`Ignoring SDEF bug: ${e}`);
            }
        }            
    }
    
    // extract name and code attributes from a class/enumerator/command/etc XML element
    
    this.attribute = function(name, element) { // String, XMLElement -> String/null
        const attr = element('attributeForName', objc(name));
        return attr === null ? null : attr('stringValue');
    }
    
    this.parseKeywordElement = function(element) { // XMLElement -> [String, OSType]
        const name = this.attribute("name", element);
        const codeString = this.attribute("code", element);
        if (name === null || codeString === null || name === "") {
            throw new aeerrors.TerminologyError("missing 'name'/'code' attribute.");
        }
        return [name, this.parseFourCharCode(codeString)];
    }
    
    this.parseCommandElement = function(element) { // XMLElement -> [String, OSType, OSType]
        const name = this.attribute("name", element);
        const codeString = this.attribute("code", element);
        if (name === null || codeString === null || name === "") {
            throw new aeerrors.TerminologyError("missing 'name'/'code' attribute.");
        }
        const [eventClass, eventID] = this.parseEightCharCode(codeString);
        return [name, eventClass, eventID];
    }
    
    //
    
    this.parseTypeOfElement = function(element) { // XMLElement -> [String, OSType] // class, record-type, value-type
        const [name, code] = this.parseKeywordElement(element);
        this.types.push([convertNameToIdentifier(name), code]);
        return [name, code];
    }
    
    this.parsePropertiesOfElement = function(element) { // XMLElement // class, class-extension, record-value
        this.iter(element('elementsForName', objc("property")), function(element) {
            const [name, code] = this.parseKeywordElement(element);
            this.properties.push([convertNameToIdentifier(name), code]);
        });
    }
    
    // parse a class/enumerator/command/etc element of a dictionary suite
    
    this.parseDefinition = function(element) { // XMLNode
        if (!element('isKindOfClass', objc.NSXMLElement('class'))) { return; }
        switch (element('name').toString()) {
        case "class":
            var [name, code] = this.parseTypeOfElement(element);
            this.parsePropertiesOfElement(element);
            // use plural class name as elements name (if not given, append "s" to singular name)
            // (note: record and value types also define plurals, but we only use plurals for element names and elements should always be classes, so we ignore those)
            const plural = element('attributeForName', objc("plural"));
            var tmp;
            if (plural !== null) {
                tmp = plural('stringValue');
            } else if (this._defaultElementsByCode[code] !== undefined) {
                // default terminology already defines 'items' and 'text' as known element names
                tmp = this._defaultElementsByCode[code];
            } else {
                // note: the spec says to append 's' to name when plural attribute isn't given; in practice, appending 's' doesn't work so well for names already ending in 's' (e.g. 'print settings'), which is really the SDEF's problem; for now we'll omit the second 's' and hope that doesn't confuse with property name
                tmp = name.toString().endsWith('s') ? name : `${name}s`
            }
            const pluralName = convertNameToIdentifier(tmp);
            this.elements.push([pluralName, code]);
            break;
        case "class-extension":
            this.parsePropertiesOfElement(element);
            break;
        case "record-type":
            this.parseTypeOfElement(element);
            this.parsePropertiesOfElement(element)
            break;
        case "value-type":
            this.parseTypeOfElement(element);
            break;
        case "enumeration":
            this.iter(element('elementsForName', objc("enumerator")), function(element) {
                var [name, code] = this.parseKeywordElement(element);
                this.enumerators.push([convertNameToIdentifier(name), code]);
            });
            break;
        case "command":
        case "event":
            var [name, eventClass, eventID] = this.parseCommandElement(element);
            // Note: overlapping command definitions (e.g. 'path to') should be processed as follows:
            // - If their names and codes are the same, only the last definition is used; other definitions are ignored
            //   and will not compile.
            // - If their names are the same but their codes are different, only the first definition is used; other
            //   definitions are ignored and will not compile.
            var previousDef = this._commandsDict[name];
            if (previousDef===undefined || (previousDef.eventClass === eventClass && previousDef.eventID === eventID)) {
                var command = {name:convertNameToIdentifier(name), eventClass:eventClass, eventID:eventID, params:{}};
                this._commandsDict[name] = command;
                this.iter(element('elementsForName', objc("parameter")), function(element) {
                    var [name, code] = this.parseKeywordElement(element);
                    command.params[convertNameToIdentifier(name)] = code;
                });
            } // else ignore duplicate declaration
            break;
        }
    }
    
    // parse the given SDEF XML data into this object's types, enumerators, properties, elements, and commands arrays
    
    this.parse = function(sdef) { // NSData
         var error = objc.alloc(objc.NSError, objc.NIL);
        const parser = objc.NSXMLDocument('alloc')('initWithData', sdef, 
                                                        'options', (1 << 16), // .documentXInclude
                                                          'error', error.ref());
        if (parser === null) {
            throw new aeerrors.TerminologyError(`can't parse SDEF XML: ${error}`);
        }
        const dictionary = parser('rootElement');
        if (dictionary === null) { throw new aeerrors.TerminologyError("missing `dictionary` element."); }
        const parseDefinition = this.parseDefinition;
        this.iter(dictionary('elementsForName', objc("suite")), function(suite) {
            var nodes = suite('children');
            if (nodes !== null) {
                this.iter(nodes, parseDefinition);
            }
        });
        for (var k in this._commandsDict) { this.commands.push(this._commandsDict[k]) }
    }
}


/****************************************************************************************/
// GlueTable; this constructs the terminology lookup tables used by AppData


function GlueTable() {
    
    this.typesByName = {};      // {String:[constructorName,code]} // Symbol members (properties, types, and enums)
    this.typesByCode = {};      // {OSType:String}
    
    this.elementsByName = {};   // {String:KeywordTerm}
    this.elementsByCode = {};   // {OSType:String}
    
    this.propertiesByName = {}; // {String:KeywordTerm} // e.g. AERecord keys
    this.propertiesByCode = {}; // {OSType:String}
    
    this.commandsByName = {};   // {String:CommandTerm}
    this.commandsByCode = {};   // {UInt64:CommandTerm} // key is eventClass<<32|eventID
    
    this._specifiersByName = null; // {String:Term}? // private; use specifiersByName() to access
    
    this._defaultTypesByName = {};
    this._defaultPropertiesByName = {};
    this._defaultElementsByName = {};
    this._defaultCommandsByName = {};

    this.inspect = function() { // TO DO: improve this (show codes has hex, show command params)
        const util = require('util');
        return util.inspect({typesByName:this.typesByName, typesByCode:this.typesByCode,
                             elementsByName:this.elementsByName, elementsByCode:this.elementsByCode,
                              propertiesByName:this.propertiesByName, propertiesByCode:this.propertiesByCode,
                              commandsByName:this.commandsByName, commandsByCode:this.commandsByCode}, _inspectOptions);
    };

    // get property/elements/command by name; this eliminates duplicate (e.g. property+elements) names,
    // according [hopefully] to the same internal rules used by AppleScript; note, however, that AS does
    // still allow elements names masked by property names to be used by adding `every` keyword;
    // TO DO: add an `ObjectSpecifier.all` property to do the same (also, review special-case handling of
    // `text` property/element - it's probably correct since AS defines `text` as an element name itself,
    // but best be safe)
    
    this.specifiersByName = function() { // {String:Term}
        if (this._specifiersByName == null) {
            this._specifiersByName = {};
            for (var termsByName of [this.elementsByName, this.propertiesByName, this.commandsByName]) {
                for (var [key, value] of termsByName) { this._specifiersByName[key] = value; }
            }
        }
        return this._specifiersByName;
    };
    
    //
    
    this._addSymbolKeywords = function(keywords, descriptorConstructorName) { // [KeywordTerm], String (method name for constructing typeType/typeEnumerated descriptor)
        const len = keywords.length;
        for (var i = 0; i < len; i++) {
            // add a definition to typeByCode table
            // to handle synonyms, if same code appears more than once then uses name from last definition in list
            var [name, code] = keywords[i];
            if (!(name === "missing value" && code === objc.cMissingValue)) { // (ignore `missing value` as it's treated separately)
                // escape definitions that semi-overlap default definitions
                var typeDef = this._defaultTypesByName[name]; // [DESC_CONSTRUCTOR, OSTYPE]
                if (typeDef !== undefined && typeDef[1] !== code) {
                    name = keywords[i][0] = escapeIdentifier(name); // change name in-place
                }
                // add item
                this.typesByCode[code] = name;
            }
            // add a definition to typeByName table
            // to handle synonyms, if same name appears more than once then uses code from first definition in list (iterating array in reverse ensures this)
            var [name, code] = keywords[len - 1 - i];
            if (!(name === "missing value" && code === objc.cMissingValue)) { // (ignore `missing value` as it's treated separately)
                // escape definitions that semi-overlap default definitions
                var typeDef = this._defaultTypesByName[name];
                if (typeDef !== undefined && typeDef[1] !== code) {
                    name = keywords[len - 1 - i][0] = escapeIdentifier(name);
                }
                // add item
                this.typesByName[name] = [descriptorConstructorName, code];
            }
        }
    };

    this._addSpecifierKeywords = function(keywords, nameTable, codeTable, defaultKeywordsByName) {
        const len = keywords.length;
        for (var i = 0; i< len; i++) {
            // add a definition to the elementsByCode/propertiesByCode table
            // to handle synonyms, if same code appears more than once then uses name from last definition in list
            var [name, code] = keywords[i];
            var defaultCode = defaultKeywordsByName[name];
            if (defaultCode !== undefined && code !== defaultCode) {
                name = keywords[i][0] = escapeIdentifier(name);
            }
            codeTable[code] = name;
            // add a definition to the elementsByName/propertiesByName table
            // to handle synonyms, if same name appears more than once then uses code from first definition in list (iterating array in reverse ensures this)
            var [name, code] = keywords[len - 1 - i];
            var defaultCode = defaultKeywordsByName[name];
            if (defaultCode !== undefined && code !== defaultCode) {
                name = keywords[len - 1 - i][0] = escapeIdentifier(name);
            }
            nameTable[name] = code;
        }
    };

    this._addCommandKeywords = function(commands) {
        const len = commands.length;
        for (var i = 0; i< len; i++) {
            // to handle synonyms, if two commands have same name but different codes, only the first definition should be used (iterating array in reverse ensures this)
            var term = commands[len - 1 - i];
            var name = term.name;
            const eventClass = term.eventClass;
            const eventID = term.eventID;
            // Avoid collisions between default commands and application-defined commands with same name
            // but different code (e.g. 'get' and 'set' in InDesign CS2):
            const existingCommandDef = this._defaultCommandsByName[name];
            if (existingCommandDef !== undefined && (existingCommandDef.eventClass != eventClass 
                                                        || existingCommandDef.eventID != eventID)) {
                    name = term.name = escapeIdentifier(name);
            }
            // add item
            this.commandsByName[name] = term;
            this.commandsByCode[toEightCharCode(eventClass, eventID)] = term;
        }
    };

    // called by parseSDEF 
    // (note: default terminology is added automatically when GlueTable is instantiated; users should not add it themselves)
    this.addTerminology = function(terms) { // terms = {types:,enumerators:,properties:,elements:,commands:}
        // build type tables
        this._addSymbolKeywords(terms.properties, 'descriptorWithTypeCode'); // technically typeProperty, but typeType is prob. safest
        this._addSymbolKeywords(terms.enumerators, 'descriptorWithEnumCode');
        this._addSymbolKeywords(terms.types, 'descriptorWithTypeCode');
        // build specifier tables
        this._addSpecifierKeywords(terms.elements, this.elementsByName,
                                   this.elementsByCode, this._defaultElementsByName);
        this._addSpecifierKeywords(terms.properties, this.propertiesByName,
                                    this.propertiesByCode, this._defaultPropertiesByName);
        // build command table
        this._addCommandKeywords(terms.commands);
        // special case: if property table contains a 'text' definition, move it to element table
        // (AppleScript always packs 'text of...' as an all-elements specifier, not a property specifier)
        // TO DO: should check if this rule only applies to 'text', or other ambiguous property/element names too
        const code = this.propertiesByName["text"];
        if (code !== undefined) {
            this.elementsByName["text"] = code;
            delete this.propertiesByName["text"];
        }
        this._specifiersByName = null;
    };
    
    // add NodeAutomation's built-in terms, used to disambiguate any conflicting app-defined names        
    this.addTerminology(kDefaultTerminology);
    // retain copies of default type and command terms; these will be used to disambiguate
    // any conflicting application-defined terms added later
    this._defaultTypesByName = Object.assign({}, this.typesByName);
    this._defaultPropertiesByName = Object.assign({}, this.propertiesByName);
    this._defaultElementsByName = Object.assign({}, this.elementsByName);
    this._defaultCommandsByName = Object.assign({}, this.commandsByName);    
    
    //
    
    this.addSDEF = function(data) { // NSData
        let parser = new SDEFParser();
        parser.parse(data);
        this.addTerminology(parser);
    };
    
    this.addSDEFAtURL = function(url) { // NSURL may be file:// or eppc://
        this.addSDEF(getScriptingDefinition(url));
    };
}


// quick-n-dirty SDEF translator; replaces AS-style keywords with JS identifiers


function translateScriptingDefinition(data) { // NSData -> NSData // TO DO: what about translating type names?
    function iter(nsarray, func) {
        for (var i = 0; i < nsarray('count'); i++) {
            try {
                func(nsarray('objectAtIndex', i));
            } catch (e) {
                console.log(`Ignoring SDEF bug: ${e}`);
            }
        }            
    }
    function convertNode(node, attributeName = "name", symbolPrefix = "") { // XMLElement, String
        const attribute = node('attributeForName', objc(attributeName));
        if (attribute !== null) {
            const value = attribute('stringValue');
            if (value !== null) {
                attribute('setStringValue', objc(symbolPrefix + convertNameToIdentifier(value)));
            }
        }
    }
    var error = objc.alloc(objc.NSError, objc.NIL);
    const xml = objc.NSXMLDocument('alloc')('initWithData', data, 
                                                 'options', objc.NSXMLDocumentXInclude, 
                                                   'error', error.ref());
    if (xml === null) {
        throw new aeerrors.TerminologyError(`Malformed SDEF resource: ${error}`);
    }
    const root = xml('rootElement');
    if (root === null) {
        throw new aeerrors.TerminologyError("Malformed SDEF resource: missing root.")
    }
    // add attributes to root node indicating SDEF has been translated to NA syntax
    function setNodeAttribute(node, name, value) {
        root('addAttribute', objc.NSXMLNode('attributeWithName', objc(name), 'stringValue', objc(value)));
    }
    setNodeAttribute(root, "apple-event-bridge-name", "NodeAutomation");
    setNodeAttribute(root, "apple-event-bridge-version", kVersion);
    // iterate over suites, converting classes, commands, enums
    iter(root('elementsForName', objc("suite")), function(suite) {
        for(var key of ["command", "event"]) {
            iter(suite('elementsForName', objc(key)), function(command) {
                convertNode(command);
                iter(command('elementsForName', objc("parameter")), function(parameter) {
                    const attribute = parameter('attributeForName', objc("name"));
                    if (attribute !== null) {
                        const value = attribute('stringValue');
                        if (value !== null) {
                            attribute('setStringValue', objc(convertNameToIdentifier(value)));
                        }
                    }
                });
            });
        }
        for (var key of ["class", "class-extension", "record-type"]) {
            iter(suite('elementsForName', objc(key)), function(klass) {
                convertNode(klass);
                convertNode(klass, "plural");
                convertNode(klass, "inherits");
                iter(klass('elementsForName', objc("element")), function(node) { convertNode(node, "type"); });
                iter(klass('elementsForName', objc("property")), function(node) { convertNode(node); });
                iter(klass('elementsForName', objc("contents")), function(node) { convertNode(node); });
                iter(klass('elementsForName', objc("responds-to")), function(node) {
                    convertNode(node); 
                    convertNode(node, "command");
                });
            });
        }
        iter(suite('elementsForName', objc("enumeration")), function(enumeration) {
            iter(enumeration('elementsForName', objc("enumerator")), function(enumerator) {
                convertNode(enumerator, "name", "k.");
            });
        });
        iter(suite('elementsForName', objc("value-type")), function(valueType) { convertNode(valueType); });
    });
    return xml('XMLDataWithOptions', objc.NSXMLDocumentIncludeContentTypeDeclaration);
}


/****************************************************************************************/
// MAIN

var _glueCache = {};

function glueTableForApplication(url) { // file/eppc NSURL -> GlueTable
    var glue = _glueCache[url];
    if (glue === undefined) {
        _glueCache[url] = glue = new GlueTable();
        try {
            glue.addSDEFAtURL(url);
        } catch (e) { // ignore error -192 as app is [presumably] 'non-scriptable'
            if (!(e instanceof aeerrors.TerminologyError && e.code === -192)) { throw e; } 
        }
    }
    return glue;
}


function exportSDEFDocumentation(applicationPath, outputPath) { // export modified SDEF for documentation use
    const url = objc.NSURL('fileURLWithPath', objc(applicationPath));
    var result = translateScriptingDefinition(getScriptingDefinition(url));
    if (!result('writeToURL', objc.NSURL('fileURLWithPath', objc(outputPath)), 'atomically', true)) {
        throw new TerminologyError(`Couldn't write SDEF to ${outputPath}`);
    }
}

function exportRawTerminology(applicationPath, outputPath = null) { // export raw terminology tables to object/file
    const url = objc.NSURL('fileURLWithPath', objc(applicationPath)); // TO DO: also accept app name only (need to move relevant functions from aeappdata.js to aesupport.js)
    const sdef = new SDEFParser();
    sdef.parse(getScriptingDefinition(url));
    const data = {appleEventBridgeName: "NodeAutomation", appleEventBridgeVersion: kVersion,
                  types:sdef.types, enumerators:sdef.enumerators, properties:sdef.properties,
                  elements:sdef.elements, commands:sdef.commands};
    if (outputPath !== null) {
        require('fs').writeFile(outputPath, JSON.stringify(data, null, '  '), 'utf8');
    } else {
        return data;
    }
}


/****************************************************************************************/


module.exports = {
    GlueTable:               GlueTable,
    glueTableForApplication: glueTableForApplication,
    exportSDEFDocumentation: exportSDEFDocumentation,
    exportRawTerminology:    exportRawTerminology,
};


// TEST

//exportRawTerminology('/Applications/Adobe InDesign CS6/Adobe InDesign CS6.app', '/Users/has/InDesign.json');

/*

const url = objc.NSURL('fileURLWithPath', objc('/Applications/TextEdit.app'));

//const p = new SDEFParser(); p.parse(getScriptingDefinition(url)); console.log(require('util').inspect(p));

const p = new GlueTable(); p.addSDEFAtURL(url); console.log(p);


exportSDEFDocumentation('/Applications/TextEdit.app', '/Users/has/TextEdit.node.sdef');

exportRawTerminology('/Applications/TextEdit.app', '/Users/has/TextEdit.node.json');

console.log(exportRawTerminology('/Applications/TextEdit.app'));

*/
