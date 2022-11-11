// format object specifiers

'use strict';

const util = require('util');

const objc = require('objc');

const aesupport = require('./aesupport');
const kae = require('./kae');


/****************************************************************************************/


function _formatAppRoot(appData) {
  if (appData.targetType === null) { return 'app'; } // TO DO: also return "app" if nested
  const methodName = appData.targetType === 'named' ? '' : `.${appData.targetType}`;
  const target = appData.targetType === 'currentApplication' ? '' : formatValue(appData.targetID, appData);
  return `app${methodName}(${target})`; // TO DO: what about options?
}


function formatSpecifierRecord(appData, specifierRecord) { // TO DO: pass flag to indicate nesting
  // TO DO: trap all errors and return opaque object representation with error description comment
  if (specifierRecord?.constructor?.name !== 'Object') { 
//    console.log(`<BUG (specifierRecord = ${util.inspect(specifierRecord)})>`)
    //process.exit()
    throw new Error( `<BUG expected specifierRecord object, got ${specifierRecord?.constructor?.name} = ${util.inspect(specifierRecord)})>`);
  } // DEBUG; TO DO: delete
  if (specifierRecord.form === aesupport.kSpecifierRoot) { // app root; format application using appData info
    switch (specifierRecord.cachedDesc.type) {
    case kae.typeNull:
      return _formatAppRoot(appData);
    case kae.typeCurrentContainer:
      return 'con';
    case kae.typeObjectBeingExamined:
      return 'its';
    default:
      return `${_formatAppRoot(appData)}.customRoot(${formatValue(specifierRecord.seld)})`;
    }
  }
  
  
  // TO DO: doesn't seem to have cases for insertionloc: beginning/end/before/after!!!
  
  
  // TO DO: review rest of this function, making sure it formats targeted and untargeted specifiers correctly
  // recursively format specifier record chain, calling formatValue() to format selector args, etc.
  let parent = formatSpecifierRecord(appData, specifierRecord.from);
  // targeted specifier
  const seld = specifierRecord.seld;
  // insertion locs are objects of form: {from:specifier object, seld:kAEBeginning/kAEEnd/kAEBefore/kAEAfter}
  if (!specifierRecord.form) {
    switch (seld) {
    case kae.kAEBeginning:  return `${parent}.beginning`;
    case kae.kAEEnd:        return `${parent}.end`;
    case kae.kAEBefore:     return `${parent}.before`;
    case kae.kAEAfter:      return `${parent}.after`;
    default:                return `${parent}.<${seld}>`;
    }
  }
  let form = specifierRecord.form;
  const want = specifierRecord.want;
  switch (form) {
  // property
  case kae.formPropertyID: // specifier.NAME or specifier.property(CODE)
    // (note: untargeted property specifiers are always stored as formAbsolutePosition, never formPropertyID, so this case only ever applies on targeted specifiers)
    if (!(seld instanceof aesupport.Keyword)) { throw new TypeError(`Bad seld for formPropertyID: expected Keyword, got ${typeof seld}`); } // DEBUG
    // TO DO: what if it's an ambiguous term that's used as both property and elements name, in which case it needs disambiguated
		const name = aesupport.isString(seld.name) ? seld.name : (appData.propertyNameForCode(seld.name) ?? 
														`property(${aesupport.formatFourCharLiteral(seld.name)})`);
    return `${parent}.${name}`;
  case kae.formUserPropertyID: // specifier.$NAME
    return `${parent}.$${pname}`;
  // element[s]
  case kae.formRelativePosition: // specifier.before/after(SYMBOL)
  {
    let methodName, typeName;
    switch (seld.name) {
    case kae.kAEPrevious:
      methodName = 'previous';
      break;
    case kae.kAENext:
      methodName = 'next';
      break;
    default:
      throw new TypeError(`Bad relative position selector: ${seld}`);
    }
    if (aesupport.isNumber(want)) { // previous/next element's type as OSType
      const code = want;
      if (specifierRecord.from.want === code) { // TO DO: confirm from.want can never be null
        typeName = ''; // omit selector arg if unneeded, e.g. `words[1].next()`, not `words[1].next(k.word)`
      } else {
        const name = appData.elementsNameForCode(code);
        typeName = (name ? `k.${name}` : `k.fromTypeCode(${aesupport.formatFourCharLiteral(code)})`);
      }
    } else { // untargeted specifier; 'want' contains element name as string
    	if (!aesupport.isString(want)) { throw new TypeError(`Bad relative position type: ${want}`); }
      typeName = (specifierRecord.from.want === want) ? '' : want;
    }
    return `${parent}.${methodName}(${typeName})`;
  }
  case kae.kAELessThan:
    return `${parent}.lt(${formatValue(seld)})`;
  case kae.kAELessThanEquals:
    return `${parent}.le(${formatValue(seld)})`;
  case kae.kAEEquals:
  {
    const packNotEquals = require('./aeselectors').packNotEqualsTest;
    return `${parent}.${specifierRecord.pack === packNotEquals ? "ne" : "eq"}(${formatValue(seld)})`;
  }
  case kae.kAEGreaterThan:
    return `${parent}.gt(${formatValue(seld)})`;
  case kae.kAEGreaterThanEquals:
    return `${parent}.ge(${formatValue(seld)})`;
  case kae.kAEBeginsWith:
    return `${parent}.beginsWith(${formatValue(seld)})`;
  case kae.kAEEndsWith:
    return `${parent}.endsWith(${formatValue(seld)})`;
  case kae.kAEContains:
  {
    const packIsIn = require('./aeselectors').packIsInTest;
    return `${parent}.${ specifierRecord.pack === packIsIn ? "isIn" : "contains"}(${formatValue(seld)})`;
  }
  case kae.kAEAND:
    return `${parent}.and(${seld.map(function(item) { return formatValue(item) }).join(", ")})`;
  case kae.kAEOR:
    return `${parent}.or(${seld.map(function(item) { return formatValue(item) }).join(", ")})`;
  case kae.kAENOT:
    return `${parent}.not`;
  }
  if (aesupport.isNumber(want)) { // OSType = elements class (i.e. it's a targeted specifier)
    const elementsName = appData.elementsNameForCode(want);
    parent += (elementsName ? `.${elementsName}` : `.elements(${aesupport.formatFourCharLiteral(want)})`);
  } else if (aesupport.isString(want)) { // property/elements name (i.e. it's an untargeted specifier)
    parent = `${parent}.${want}`;
  } else { // implementation bug (i.e. this should never happen)
		throw new Error(`BUG: Bad 'want' (not property/element name or OSType): ${want}`);
  }
  switch (form) {
  case kae.formAbsolutePosition: // specifier.at(IDX)/first/middle/last/any
    if (seld instanceof aesupport.Keyword && seld.type === kae.typeAbsoluteOrdinal) {
      switch (seld.name) {
      case kae.kAEFirst:
        return `${parent}.first`;
      case kae.kAEMiddle:
        return `${parent}.middle`;
      case kae.kAELast:
        return `${parent}.last`;
      case kae.kAEAny:
        return `${parent}.any`;
      case kae.kAEAll:
        return `${parent}`;
      default:
      throw new TypeError(`Bad absolute ordinal selector: ${seld}`);
      }
    } else {
      return `${parent}.at(${formatValue(seld)})`;
    } // TO DO: check this and other code that prints seld: is it unpacked or desc?
  case kae.formName: // specifier[NAME] or specifier.named(NAME)
    return `${parent}.named(${formatValue(seld)})`;
  case kae.formUniqueID: // specifier.ID(UID)
    return `${parent}.ID(${formatValue(seld)})`;
    
  case kae.formRange: // specifier.thru(FROM,TO)
    // TO DO: show start/stop in shorthand form if their want is same as parent.want and they're absolute numeric index or name string
    return `${parent}.thru(${formatValue(seld.start)}, ${formatValue(seld.stop)})`;
  case kae.formTest: // specifier.where(TEST)
    return `${parent}.where(${formatValue(seld)})`;
  }
  throw new TypeError(`Invalid specifier form: ${specifierRecord.form}`);
}


function formatValue(value) {

  //console.log(`aeformatter.formatValue ${typeof value === 'object' ? value.constructor.name : typeof value}`)

  if (value === null || value === undefined) {
    return String(value);
  } else if (value[aesupport.__packSelf] !== undefined) { // Specifier/Keyword/File
    return String(value);
  } else if (value instanceof Date) {
    return `new Date(${util.inspect(value)})`; // util.inspect() annoyingly doesn't return a JS literal string
  } else if (value instanceof Array) {
    return `[${value.map(formatValue).join(', ')}]`;
//  } else if (typeof value === 'function' || objc.isObject(value)) { // TO DO: should we care?
//    console.log(`Warning: nodeautomation's formatValue() received an unsupported ${typeof value}: ${value}`); // DEBUG
  } // TO DO: any other objects need special handling? (e.g. will util.inspect() be sufficient for formatting AE records?)
  return util.inspect(value);
}


function formatCommand(appData, commandDef, parentSpecifierRecord, parametersObject) {
  let result = formatSpecifierRecord(appData, parentSpecifierRecord);
  if (commandDef.name) {
    result += `.${commandDef.name}(`;
  } else {
    result += `.sendAppleEvent(${aesupport.formatFourCharLiteral(commandDef.eventClass)}, ${aesupport.formatFourCharLiteral(commandDef.eventID)}, `;
  }
  // TO DO: rework the following to format numeric keys as four-char strings
  let hasParams = false;
  for (let k in parametersObject) { hasParams = true; }
  return `${result}${(hasParams ? formatValue(parametersObject) : '')})`;
}


// TO DO: formatAppleEvent(appleEvent) { ... } // note: this needs to get AEAddressDesc and coerce it to typeKernelProcessID, throwing on failure; the PID is then used to get app bundle's full path and file name (the latter is used to look up app bundle path in Launch Services; if both paths are same then only app name need be shown, not full path); pass the name/path to app(...), then get its AppData instance and use that to unpack attrs and params and get commanddef, and reconstruct command's literal JS syntax from there

function applicationPathForAddressDescriptor(addressDesc) { // NSAppleEventDescriptor -> string
  if (addressDesc.descriptorType() === kae.typeProcessSerialNumber) { // AppleScript is old school
    addressDesc = addressDesc.coerceToDescriptorType_(kae.typeKernelProcessID);
  }
  if (!addressDesc || addressDesc.descriptorType() !== kae.typeKernelProcessID) { // local processes are generally targeted by PID
    throw new TypeError(`Unsupported address type: ${aesupport.formatFourCharLiteral(addressDesc.descriptorType())}`);
  }
  const b = Buffer.alloc(4); // pid_t
  addressDesc.data().getBytes_length_(b, 4);
  const pid = b.readInt32LE();
  const process = objc.NSRunningApplication.runningApplicationWithProcessIdentifier_(pid);
  if (!process) { throw new Error(`Can't find application process (PID: ${pid}).`); }
  const applicationURL = process.bundleURL();
  if (!applicationURL) { throw new Error("Can't get path to application bundle (PID: \(pid))."); }
  return objc.js(applicationURL.path());
}


function paramNamesByCode(commandDef) {
	const paramsByCode = {};
	for (let [name, code] in Object.entries(commandDef.params)) { paramsByCode[code] = name; }
	return paramsByCode;
}

function formatAppleEvent(appleEvent) { // currently unused (it's intended for converting AEs from AS to JS syntax a la ASTranslate)
  if (!(aesupport.isNSAppleEventDescriptor(appleEvent) && appleEvent.descriptorType() === kae.typeAppleEvent)) {
    throw new TypeError(`formatAppleEvent() expected Apple event descriptor but received: ${appleEvent}`);
  }
  const aeappdata = require("./aeappdata");
  const aeselectors = require('./aeselectors');
  const addressDesc = appleEvent.attributeDescriptorForKeyword_(kae.keyAddressAttr);
  const applicationPath = applicationPathForAddressDescriptor(addressDesc);
  // TO DO: check if full applicationPath === LaunchServices path for app's file name; if true, pass name only here
  const appData = new aeappdata.AppData("named", applicationPath, {});
  const eventClass = appleEvent.attributeDescriptorForKeyword_(kae.keyEventClassAttr).typeCodeValue();
  const eventID = appleEvent.attributeDescriptorForKeyword_(kae.keyEventIDAttr).typeCodeValue();
  // TO DO: what about kAECoreSuite/kASSubroutineEvent? format keyASSubroutineName as $NAME
  const commandDef = appData.commandDefinitionForCode(eventClass, eventID);
  const paramsByCode = commandDef ? paramNamesByCode(commandDef) : {};
  let directParam = undefined, params = [], subject = undefined;
  for (let i = 1; i <= appleEvent.numberOfItems(); i++) {
    let value = appleEvent.descriptorAtIndex_(i);
    try {
      value = appData.unpack(value);
    } catch (e) {}
    const code = event.keywordForDescriptorAtIndex_(i);
    switch (code) {
    case kae.keyDirectObject:
      directParam = value;
      break;
    case kae.keyAERequestedType: 
      params.push(`asType:${formatValue(value)}`);
      break;
    case kae.keyASUserRecordFields:
      // TO DO: format as $KEY:VALUE,...
    default:
      params.push(`${(paramsByCode[code] ?? aesupport.formatFourCharLiteral(code))}:${formatValue(value)}`);
    }
  }
  let desc = appleEvent.attributeDescriptorForKeyword_(kae.keySubjectAttr);
  if (desc && desc.descriptorType() !== kae.typeNull) { // typeNull = root application object
    try {
      subject = appData.unpack(desc);
    } catch (e) {
      subject = desc;
    }
  }
  // unpack reply requested and timeout attributes (TO DO: these attributes are unreliable since their values are passed into AESendMessage() rather than packed directly into the AppleEvent; should work for intercepted AEs sent by AS component, which is what translation tool consumes, but need to check)
  desc = appleEvent.attributeDescriptorForKeyword_(kae.keyReplyRequestedAttr);
  // keyReplyRequestedAttr appears to be boolean value encoded as Int32 (1=wait or queue reply; 0=no reply)
  if (desc && desc.int32Value() === 0) { params.push("sendOptions:[k.noReply]"); } // AS doesn't support most options
  // timeout
  desc = appleEvent.attributeDescriptorForKeyword_(kae.keyTimeoutAttr);
  if (desc) {
    const timeoutInTicks = timeout.int32Value
    if (timeoutInTicks == kae.kNoTimeOut) { // 'kNoTimeOut = -2' but we use <=0 as 'no timeout'
      params.push("withTimeout:0");
    } else if (timeoutInTicks > 0) { // ignore 'kAEDefaultTimeout = -1'
      params.push(`withTimeout:${timeoutInTicks / 60.0}`);
    }
  }
  // considering/ignoring attributes
  /* TO DO: "ignoring:[...]"
    if let considersAndIgnoresDesc = event.attributeDescriptor(forKeyword: _enumConsidsAndIgnores) {
      let considersAndIgnores: UInt32 = 0
      (considersAndIgnoresDesc.data as NSData).getBytes(&considersAndIgnores, length: MemoryLayout<UInt32>.size)
      if considersAndIgnores != defaultConsidersIgnoresMask {
        for (option, _, considersFlag, ignoresFlag) in considerationsTable {
          if option == .case {
            if considersAndIgnores & ignoresFlag > 0 { self.considering.remove(option) }
          } else {
            if considersAndIgnores & considersFlag > 0 { self.considering.insert(option) }
          }
        }
      }
    }
  */
  let result;
  if (subject !== undefined) {
    if (aeselectors.isSpecifier(subject)) {
      result = String(subject);
    } else {
      result = `${_formatAppRoot(appData)}.customRoot(${formatValue(subject)})`;
    }
  } else if (aeselectors.isSpecifier(directParam)) {
    result = String(directParam);
    directParam = undefined;
  }
  if (directParam !== undefined) { params.push(`_:${formatValue(directParam)}`); }
  const arg = (params ? `{${params.join(', ')}}` : "");
  if (commandDef) {
    result += `.${commandDef.name}(${arg})`;
  } else {
    result += `.sendAppleEvent(${aesupport.formatFourCharLiteral(eventClass)}, ${aesupport.formatFourCharLiteral(eventID)}, ${arg})`;
  }
  return result;
}


/****************************************************************************************/


module.exports.formatSpecifierRecord  = formatSpecifierRecord;
module.exports.formatValue            = formatValue; 
module.exports.formatCommand          = formatCommand;
module.exports.paramNamesByCode       = paramNamesByCode;

