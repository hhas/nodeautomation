// pack/unpack AEDescs and send AppleEvents

'use strict';

// AppData

const os = require('os');
const util = require('util');

const ffi = require('ffi-napi');
const ref = require('ref-napi');
const StructType = require('ref-struct-di')(ref);

const objc = require('objc');

const aeselectors = require('./aeselectors');
const aeformatter = require('./aeformatter');
const aegluetable = require('./aegluetable');
const aesupport = require('./aesupport');
const aeerrors = require('./aeerrors');
const kae = require('./kae');


/******************************************************************************/
// low-level pack/unpack

// (ideally we'd serialize AEs directly to Mach messages, but IIRC those use a different layout to AEFlatten and will be more work to reverse-engineer)

const aem = new ffi.Library(null, {
  // OSStatus AEUnflattenDesc(const void *buffer, AEDesc *result);
  AEUnflattenDesc: ['int', ['pointer', 'pointer']], // used for JS->AEDesc
  // Size AESizeOfFlattenedDesc(const AEDesc *theAEDesc);
  AESizeOfFlattenedDesc: ['long', ['pointer']],
  // OSStatus AEFlattenDesc(const AEDesc *theAEDesc, Ptr buffer, Size bufferSize, Size *actualSize);
  AEFlattenDesc: ['int', ['pointer', 'pointer', 'long', 'pointer']], // used for AEDesc->JS
  
  AEDisposeDesc: ['int16', ['pointer']],
  AESendMessage: ['int', ['pointer', 'pointer', 'int', 'long']],
});

const AEDesc = StructType({descriptorType: ref.types.uint, dataHandle: ref.refType(ref.types.void)});


// need to define C AEDesc types to use objc.NSAppleEventDescriptor's -initWithAEDescNoCopy: and -aeDesc methods
// -[NSAppleEventDescriptor initWithAEDescNoCopy:]
// '@24@0:8r^{AEDesc=I^^{OpaqueAEDataStorageType}}16'
// -[NSAppleEventDescriptor aeDesc]
// 'r^{AEDesc=I^^{OpaqueAEDataStorageType}}16@0:8'
objc.defineStruct('{AEDesc="descriptorType"I"dataHandle"?}');

// <opaque name='AEDataStorageType' type64='^{OpaqueAEDataStorageType=}'/>
objc.defineStruct('{OpaqueAEDataStorageType=}');

//

const DATE_OFFSET = new Date(0) - new Date(1904, 1, 1); // ms

const isBE = os.endianness() === 'BE';

function readBOM(rawBuffer) {
  if (rawBuffer.aeoffset < rawBuffer.length - 2) {
    const bom = rawBuffer.readUInt16BE(rawBuffer.aeoffset);
    if (bom === 0xFEFF) {
      return 'BE';
    } else if (bom === 0xFFFE) {
      return 'LE';
    }
  }
  return null; // default
}


const AEBUFFER_SIZE = 1024; // outgoing AEs are typically 512-1024 bytes, unless they contain text (in which case the buffer will resize once)


class AEDescriptorBuffer {
  // dynamic-resizing buffer used by AppData.pack
  
  constructor(hasHeader = true) {
    this.rawBuffer = new Buffer.alloc(AEBUFFER_SIZE, '^'); // important: callers should write directly to buffer only when filling previously allocated bytes with final value (e.g. count, remainingBytes)
    this.offset = 0; // important: callers must not increment offset directly; see allocate/align
    if (hasHeader) { // all flattened descs start with 'dle2\0\0\0\0'
      this.writeUInt32BE(0x646c6532); // format 'dle2'
      this.writeUInt32BE(0); // align
    }
  }
  
  _grow(minimum = 0) {
    // grow the buffer
    // minimum : integer -- if given, new buffer will contain at least this number of free bytes
    const oldBuffer = this.rawBuffer;
    let size = oldBuffer.length * 2;
    if (minimum) {
      minimum += this.offset;
      while (size < minimum) { size *= 2; }
    }
    this.rawBuffer = new Buffer.alloc(size);
    oldBuffer.copy(this.rawBuffer, 0, 0, this.offset);
    //console.log('grew', size)
  }
  
  allocate(bytesRequired) { // allocate buffer space to write later; returns offset at which to write
    if (this.offset + bytesRequired > this.rawBuffer.length) { this._grow(); }
    const offset = this.offset;
    this.offset += bytesRequired;
    return offset;
  }
  
  align() { // ensure buffer is aligned on an even byte
    if (this.offset % 2 !== 0) {
      this.rawBuffer.writeUInt8(0, this.offset);
      this.offset += 1;
    }
  }
  
  // use these methods to write to rawBuffer
  
  fill(value, bytesRequired) { // caution: caller is responsible for correct alignment
    if (this.offset + bytesRequired > this.rawBuffer.length) { this._grow(); }
    this.rawBuffer.fill(value, this.offset, this.offset + bytesRequired);
    this.offset += bytesRequired;
  }
  
  writeUInt8(value) { // caution: caller is responsible for correct alignment
    const bytesRequired = 1;
    if (this.offset + bytesRequired > this.rawBuffer.length) { this._grow(); }
    this.rawBuffer.writeUInt8(value, this.offset);
    this.offset += bytesRequired;
    return bytesRequired;
  }
  
  writeInt16BE(value) { // return ID
    const bytesRequired = 2;
    if (this.offset + bytesRequired > this.rawBuffer.length) { this._grow(); }
    this.rawBuffer.writeInt16BE(value, this.offset);
    this.offset += bytesRequired;
    return bytesRequired;
  }
  
  writeUInt16BE(value) {
    const bytesRequired = 2;
    if (this.offset + bytesRequired > this.rawBuffer.length) { this._grow(); }
    this.rawBuffer.writeUInt16BE(value, this.offset);
    this.offset += bytesRequired;
    return bytesRequired;
  }
  
  writeInt32BE(value) { // number
    const bytesRequired = 4;
    if (this.offset + bytesRequired > this.rawBuffer.length) { this._grow(); }
    this.rawBuffer.writeInt32BE(value, this.offset);
    this.offset += bytesRequired;
    return bytesRequired;
  }
  
  writeUInt32BE(value) { // OSType, size, align
    const bytesRequired = 4;
    if (this.offset + bytesRequired > this.rawBuffer.length) { this._grow(); }
    this.rawBuffer.writeUInt32BE(value, this.offset);
    this.offset += bytesRequired;
    return bytesRequired;
  }
  
  writeInt64BE(value) { // typeLongDateTime
    const bytesRequired = 8;
    if (this.offset + bytesRequired > this.rawBuffer.length) { this._grow(); }
    this.rawBuffer.writeInt64BE(value, this.offset);
    this.offset += bytesRequired;
    return bytesRequired;
  }

  writeDoubleBE(value) { // number
    const bytesRequired = 8;
    if (this.offset + bytesRequired > this.rawBuffer.length) { this._grow(); }
    this.rawBuffer.writeDoubleBE(value, this.offset);
    this.offset += bytesRequired;
    return bytesRequired;
  }
  
  writeUTF8(value) { // string
    // Result : integer -- number of bytes written, not including alignment byte (caller typically uses this to set descriptor's data size after the variable-length data is written)
    // note: on return, .offset is aligned on an even byte
    // TO DO: dunno what's fastest: utf8/utf16le; or possibly monkey-patch utf16be
    // also, it is probably quicker to write to buffer, then check if offset+bytesWritten===buffer.length; if it does, assume write was incomplete, grow buffer, and rewrite
    const bytesRequired = Buffer.byteLength(value, 'utf8');
    if (this.offset + bytesRequired > this.rawBuffer.length) { this._grow(bytesRequired); }
    let bytesWritten = this.rawBuffer.write(value, this.offset, bytesRequired, 'utf8');
    this.offset += bytesWritten;
    this.align();
    return bytesWritten;
  }
  
  writeUTF16BE(value) { // string
    // Result : integer -- number of bytes written
    // TO DO: dunno what's fastest: utf8/utf16le; or possibly monkey-patch utf16be
    // also, it is probably quicker to write to buffer, then check if offset+bytesWritten===buffer.length; if it does, assume write was incomplete, grow buffer, and rewrite
    const bytesRequired = Buffer.byteLength(value, 'utf16le');
    if (this.offset + bytesRequired > this.rawBuffer.length) { this._grow(bytesRequired); }
    const startOffset = this.offset;
    const bytesWritten = this.rawBuffer.write(value, startOffset, bytesRequired, 'utf16le');
    this.rawBuffer.subarray(startOffset, startOffset + bytesRequired).swap16(); // convert to BE, which typeUnicodeText seems to be even on LE machines
    this.offset += bytesWritten;
    return bytesWritten;
  }
  
  writeBuffer(buffer) {
    // buffer : Buffer -- a complete buffer or a subarray into a larger buffer, representing a complete, serialized AEDesc from its descriptorType to end of data
    // Result : integer -- number of bytes written, not including alignment byte
    // note: on return, offset is aligned on an even byte
    if (!(buffer instanceof Buffer)) { throw new TypeError(`writeBuffer expected Buffer, got ${typeof buffer}: ${util.inspect(buffer)}`); }
    const bytesRequired = buffer.length;
    if (this.offset + bytesRequired > this.rawBuffer.length) { this._grow(bytesRequired); }
    buffer.copy(this.rawBuffer, this.offset);
    this.offset += bytesRequired;
    this.align();
    return bytesRequired;
  }
  
  toAEDesc() {
    // Result: Buffer -- AEDesc*
    // caller is responsible for retaining and disposing the returned AEDesc*
    const ptr = ref.alloc('pointer');
    // note: the rawBuffer may be larger than the flattened AEDesc data (the extra bytes are not an issue for AEUnflattenDesc as serialized AEDescs already include their own size); for now we use Buffer.alloc, not Buffer.allocUnsafe, so those extra bytes will always be initialized to 00
    const err = aem.AEUnflattenDesc(this.rawBuffer, ptr);
    if (err !== 0) {
      throw new Error(`Error ${err}: failed to unflatten buffer:\n<${this.rawBuffer.subarray(0, this.offset)}>`);
    }
    return ptr;
  }
  
  toNSAppleEventDescriptor() {
    // Result: NSAppleEventDescriptor -- this owns its own AEDesc
    return objc.NSAppleEventDescriptor.alloc().initWithAEDescNoCopy_(this.toAEDesc());
  }
  
  [Symbol.toPrimitive](hint) {
    return hint === 'number' ? Number.NaN : this[util.inspect.custom]();
  }
  
  [util.inspect.custom]() {
    return `<${this.rawBuffer.subarray(0, this.offset)}>`;
  }
}


function unflattenAEDesc(rawBuffer) {
  const ptr = ref.alloc('pointer');
  const err = aem.AEUnflattenDesc(rawBuffer, ptr);
  if (err !== 0) { throw new Error(`Error ${err}: can't unflatten buffer:\n<${rawBuffer}>`); }
  return ptr;
}


function flattenAEDesc(aeDescPtr) {
  // aeDescPtr : Buffer -- ref-napi pointer to an AEDesc struct
  // Result: Buffer -- 'dle2....TYPESIZEDATA'
  const size = aem.AESizeOfFlattenedDesc(aeDescPtr);
  const rawBuffer = new Buffer.alloc(size);
  const writtenSize = ref.alloc(ref.types.long, 3);
  const err = aem.AEFlattenDesc(aeDescPtr, rawBuffer, size, writtenSize);
  if (err !== 0) { // this shouldn't happen unless the descriptor is corrupted
    throw new Error(`Error ${err}: can't flatten AEDesc: ${aeDescPtr}`);
  }
  return rawBuffer;
}


function flattenNSAppleEventDescriptor(desc) {
  // desc : objc.NSAppleEventDescriptor
  // Result: Buffer -- 'dle2....TYPESIZEDATA'
  return flattenAEDesc(desc.aeDesc().value.ref());
}



// for debug use
aesupport.AEDescriptorBuffer = AEDescriptorBuffer;


/****************************************************************************************/
// application launch/relaunch options

// deprecated in macOS12
// -[NSWorkspace launchApplicationAtURL:options:configuration:error:]

const kLaunchOptions = {
  launchWithErrorPresentation:    0x00000040,
  launchInhibitingBackgroundOnly: 0x00000080,
  launchWithoutAddingToRecents:   0x00000100,
  launchWithoutActivation:        0x00000200,
  launchNewInstance:              0x00080000,
  launchAndHide:                  0x00100000,
  launchAndHideOthers:            0x00200000,
}; // launchAndPrint and launchAsync are omitted as they're not appropriate here

const kDefaultLaunchOptions = kLaunchOptions.launchWithoutActivation;

function readLaunchOptions(value) { // [Keyword,...] -> UInt32
  let launch = 0, relaunch = 0;
  if (!Array.isArray(value)) { value = [value]; }
  for (let item in value) {
    if (!(item instanceof aesupport.Keyword)) {
      throw new TypeError(`Bad "launchOptions" value (not an array of keywords): ${aeformatter.formatValue(value)}`);
    }
    const flag = kLaunchOptions[item.name];
    if (flag === undefined) {
      throw new TypeError(`Bad "launchOptions" value (unknown "${item}" keyword): ${aeformatter.formatValue(value)}`);
    }
    launch |= flag;
  }
  return launch;
}

// relaunch mode

const kRelaunchModes = { // supported k.MODE options in `app(NAME,{autoRelaunch:...})
  never:   1,
  limited: 2,
  always:  3,
};

const kDefaultRelaunchMode = kRelaunchModes.limited;

function readRelaunchMode(value) {
  if (!(value instanceof aesupport.Keyword)) {
     throw new TypeError(`Bad "relaunchMode" value (not a keyword): ${aeformatter.formatValue(value)}`);
  }
  const flag = kRelaunchModes[value.name];
  if (flag === undefined) {
    throw new TypeError(`Bad "relaunchMode" value (unknown "${value}" keyword): ${value}`);
  }
  return flag;
}

// the following AEM errors indicate when a previously targeted target process is no longer running (has quit/crashed)
const kRelaunchableErrorCodes = [-600, -609];

// when k.limited relaunch mode (the default) is used, the following events are allowed to relaunch an app
const kLimitedRelaunchEvents = [`${kae.kCoreEventClass}/${kae.kAEOpenApplication}`,  // `someApp.run()`
                `${kae.kASAppleScriptSuite}/${kae.kASLaunchEvent}`]; // `someApp.launch()`


/****************************************************************************************/
// -[NSAppleEventDescriptor sendEventWithOptions:timeout:] flags

const kSendOptions = {
  ignoreReply:  0x00000001, /* sender doesn't want a reply to event */
  queueReply:   0x00000002, /* sender wants a reply but won't wait */
  waitReply:    0x00000003, /* sender wants a reply and will wait */
  neverInteract:  0x00000010, /* server should not interact with user */
  canInteract:  0x00000020, /* server may try to interact with user */
  alwaysInteract: 0x00000030, /* server should always interact with user where appropriate */
  canSwitchLayer: 0x00000040, /* interaction may switch layer */
  dontRecord:   0x00001000, /* don't record this event */
  dontExecute:  0x00002000, /* don't send the event for recording */
  dontAnnotate:   0x00010000, /* if set, don't automatically add any sandbox or other annotations to the event */
  defaultOptions: 0x00000003 | 0x00000020, /* waitForReply | canInteract */
};

function readSendOptions(value) { // [Keyword,...] -> UInt32
  let sendFlags = 0;
  if (!Array.isArray(value)) { value = [value]; }
  for (let item of value) {
    if (!(item instanceof aesupport.Keyword)) {
      throw new TypeError(`Bad "sendOptions" value (not an array of keywords): ${aeformatter.formatValue(value)}`);
    }
    const flag = kSendOptions[item.name];
    if (flag === undefined) {
      throw new TypeError(`Bad "sendOptions" value (contains unknown "${item}" keyword): ${aeformatter.formatValue(value)}`);
    } else if (flag & 0x03 && sendFlags & 0x03 || flag & 0x30 && sendFlags & 0x30) {
      throw new TypeError(`Bad "sendOptions" value (contains more than one "${flag & 0x03 ? 'reply' : 'interact'}" option): ${aeformatter.formatValue(value)}`);
    }
    sendFlags |= flag;
  }
  if (!(sendFlags & 0x03)) { sendFlags |= kSendOptions.waitReply; }
  if (!(sendFlags & 0x30)) { sendFlags |= kSendOptions.canInteract; }
  return sendFlags;
}

const kDefaultSendOptions = kSendOptions.defaultOptions;

const kInteractionLevelMask = kSendOptions.canSwitchLayer | kSendOptions.canInteract | 
                kSendOptions.alwaysInteract | kSendOptions.neverInteract;

const kWantsReplyMask = kSendOptions.ignoreReply | kSendOptions.queueReply | kSendOptions.waitReply;

/****************************************************************************************/
// considering/ignoring options (where supported by apps)

const kIgnoringOptions = {
 case:           {key: aesupport.Keyword.fromEnumCode(kae.kAECase),           ignore: 0x00010000, consider: 0x00000001},
 diacritic:      {key: aesupport.Keyword.fromEnumCode(kae.kAEDiacritic),      ignore: 0x00020000, consider: 0x00000002},
 whiteSpace:     {key: aesupport.Keyword.fromEnumCode(kae.kAEWhiteSpace),     ignore: 0x00040000, consider: 0x00000004},
 hyphens:        {key: aesupport.Keyword.fromEnumCode(kae.kAEHyphens),        ignore: 0x00080000, consider: 0x00000008},
 expansion:      {key: aesupport.Keyword.fromEnumCode(kae.kAEExpansion),      ignore: 0x00100000, consider: 0x00000010},
 punctuation:    {key: aesupport.Keyword.fromEnumCode(kae.kAEPunctuation),    ignore: 0x00200000, consider: 0x00000020},
 numericStrings: {key: aesupport.Keyword.fromEnumCode(kae.kASNumericStrings), ignore: 0x00800000, consider: 0x00000080},
}; 

const _considerAll = Object.values(kIgnoringOptions).reduce((a, o) => a | o.consider);

function readIgnoringOptions(value) {
  // value : [Keyword]
  // Result: {[Keyword], Keyword}
  let considerIgnoreFlags = _considerAll; // all considering flags; these will be unset as ignoring flags are set
  const ignoresList = [];
  if (!(value instanceof Array)) { value = [value]; }
  for (let item of value) {
    if (!(item instanceof aesupport.Keyword)) {
      throw new aeerrors.ParameterError(value, 'Bad "ignoring" attribute');
    }
    const optionDef = kIgnoringOptions[item.name];
    if (optionDef === undefined) {
      throw new TypeError(`Bad "ignoring" attribute (unknown item: ${item}): ${aeformatter.formatValue(value)}`);
    }
    considerIgnoreFlags |= optionDef.ignore;
    considerIgnoreFlags &= ~optionDef.consider;
    ignoresList.push(optionDef.key);
  }
  return {ignoresList, considerIgnoreFlags: new aesupport.Keyword(considerIgnoreFlags, kae.typeUInt32)}; // kludgy
}

const kDefaultIgnoringDescriptors = readIgnoringOptions([new aesupport.Keyword('case')]);


/****************************************************************************************/
// other constants

const kAEDefaultTimeout = -1
const kNoTimeOut = -2

const kMissingValueDescriptor = objc.NSAppleEventDescriptor.descriptorWithTypeCode_(kae.cMissingValue);

// check when unpacking
const kComparisonOperatorCodes = new Set([kae.kAELessThan, kae.kAELessThanEquals, kae.kAEEquals, kae.kAEGreaterThan, 
                    kae.kAEGreaterThanEquals, kae.kAEBeginsWith, kae.kAEEndsWith, kae.kAEContains]);
const kLogicalOperatorCodes = new Set([kae.kAEAND, kae.kAEOR, kae.kAENOT]);


/****************************************************************************************/
// find and launch application processes

// TO DO: this seems to give different result to AS's `running` when `launch` was used to semi-start process

function fileIDForURL(url) { // NSURL -> NSData // used in determining if two existing file URLs identify same inode
  const fileIDRef = new objc.Ref();
  if (!url.getResourceValue_forKey_error_(fileIDRef, objc.NSURLFileResourceIdentifierKey, null)) {
    throw new Error(`Can't get NSURLFileResourceIdentifierKey for ${url}`);
  }
  return fileIDRef.deref();
}


function processForLocalApplication(url) { // NSURL -> NSRunningApplication/null
  const bundle = objc.NSBundle.bundleWithURL_(url);
  if (!bundle) { throw new aeerrors.ConnectionError(`Application not found: ${objc.js(url.path())}`); }
  const bundleID = bundle.bundleIdentifier();
  if (!bundleID) { throw new aeerrors.ConnectionError(`Application not found: ${objc.js(url.path())}`); }
  const foundProcesses = objc.NSRunningApplication.runningApplicationsWithBundleIdentifier_(bundleID);
  const fileID = fileIDForURL(url);
  for (let i = 0; i < foundProcesses.count(); i++) {
    const process = foundProcesses.objectAtIndex_(i);
    const processFileID = fileIDForURL(process.bundleURL()); // may be null
    if (processFileID && processFileID.isEqual_(fileID)) { return process; }
  }
  return null;
}


function infoForNSError(error) { // NSError -> (string, number); extract error message + number from NSError
  return [objc.js(error.localizedDescription()), error.code()];
}


function processDescriptorForLocalApplication(url, launchOptions) { // (NSURL, NSWorkspaceLaunchOptions) // file URL
  // get a typeKernelProcessID AEAddressDesc for the target app, finding and launch it first if not already running;
  // if app can't be found/launched, throws a ConnectionError/NSError instead
  let runningProcess = processForLocalApplication(url);
  if (!runningProcess) {
    const error = new objc.Ref();
    launchOptions = launchOptions |= kLaunchOptions.launchWithoutActivation; // TO DO: decide if this is best solution
    runningProcess = objc.NSWorkspace.sharedWorkspace().launchApplicationAtURL_options_configuration_error_(
                                    url, 
                                    launchOptions, 
                                    objc.NSDictionary.dictionary(), 
                                    error);
    if (!runningProcess) {
      const [message, number] = infoForNSError(error.deref());
      throw new aeerrors.ConnectionError(
          `Can't launch application at ${util.inspect(objc.js(url.path()))}: ${message}`, number);
    }
  }
  return objc.NSAppleEventDescriptor.descriptorWithProcessIdentifier_(runningProcess.processIdentifier());
}


const kProcessNotFoundErrorNumbers = [kae.procNotFound, kae.connectionInvalid, kae.localOnlyErr];

const kLaunchEvent = objc.NSAppleEventDescriptor.appleEventWithEventClass_eventID_targetDescriptor_returnID_transactionID_(
                                    kae.kASAppleScriptSuite, 
                                    kae.kASLaunchEvent, 
                                    null, 
                                    kae.kAutoGenerateReturnID, 
                                    kae.kAnyTransactionID);

function launchApplicationAtURL(url) { // NSURL -- fileURL
  const config = objc.NSDictionary.dictionaryWithObject_forKey_(kLaunchEvent, 
                                  'NSWorkspaceLaunchConfigurationAppleEvent');
  const error = new objc.Ref();
  const runningProcess = objc.NSWorkspace.sharedWorkspace().launchApplicationAtURL_options_configuration_error(
                                      url, 
                                      kLaunchOptions.launchWithoutActivation,
                                      config,
                                      error);
  if (!runningProcess) {
    const [message, number] = infoForNSError(error.deref());
    throw new aeerrors.ConnectionError(`Can't launch application at ${util.inspect(objc.js(url.path()))}: ${message}`, number);
  }
}


/****************************************************************************************/
// APPLICATION DATA
/****************************************************************************************/
// targeted specifiers constain an AppData instance that contains an AEAddressDesc for a specific app along with that app's terminology tables


class AppData {
  // caution: AppData instances replace their terminology lookup methods on first use
  
  constructor(targetType, targetID, options) {
    if (typeof options !== 'object') {
      throw new TypeError(`Bad application options argument (not an object): ${options}`);
    }
    this.workspaceLaunchOptions = (options.launchOptions !== undefined ? readLaunchOptions(options.launchOptions)
                                       : kDefaultLaunchOptions);
    this.relaunchMode = (options.autoRelaunch !== undefined ? readRelaunchMode(options.autoRelaunch)
                                : kDefaultRelaunchMode);
    if (options.logAppleEvents) { // TO DO: and/or take a function
      const sendFn = this._sendAppleEvent;
      this._sendAppleEvent = function (aeBuffer, sendOptions, timeout) {
        console.log('AE SEND: ', aeBuffer.toNSAppleEventDescriptor()); // outgoing Apple event
        const [replyBuffer, errorCode] = sendFn(aeBuffer, sendOptions, timeout);
        if (replyBuffer) { // application result/error
          console.log('AE REPLY:', 
              objc.NSAppleEventDescriptor.alloc().initWithAEDescNoCopy_(unflattenAEDesc(replyBuffer)));
        } else {
          console.log('AE ERROR:', errorCode); // Apple Event Manager error
        }
        return [replyBuffer, errorCode];
      };
    }
    if (!options.terminology) {
      this.terminologyTables = null;
    } else if (aesupport.isString(options.terminology)) { // file path
      try {
        this.terminologyTables = JSON.parse(require('fs').readFileSync(options.terminology, 'utf8'));
        if (typeof this.terminologyTables !== 'object') {
          throw new TypeError(`JSON file doesn't contain a terminology object: ${this.terminologyTables}`);
        }
      } catch (e) {
        throw new aeerrors.TerminologyError(
          `Can't read terminology from file ${aeformatter.formatValue(options.terminology)}: ${e}`);
      }
    } else if (typeof options.terminology === 'object') {
      this.terminologyTables = options.terminology;
    } else {
      throw new TypeError(`Bad "terminology" value (not an object/string/null): ${options.terminology}`);
    }
    // used by formatter
    this.targetType = targetType;
    this.targetID = targetID;
    this._targetDescriptor = null; // TO DO: [re]connect as necessary; throw on fail
      
    // Note: object specifiers returned by app are normally lazily unpacked for efficiency (the topmost objspec is unpacked, and a Proxy object containing the rest of the specifier is stored in its "from" slot, to be unpacked only if needed, e.g. for display purposes). This differs from AS's unpacking behavior (AS fully unpacks object specifiers and does not cache the returned descriptor for reuse, so must fully repack them on next use), so in very rare cases (e.g. iView Media Pro) might cause app compatibility problems. To fully unpack and repack object specifiers (slower, but mimics AS's own behavior), override AppData.newSpecifier() to recursively set specifier records' cachedDesc slots to null before passing the records to aeselectors.newSpecifier.
    this.newSpecifier = aeselectors.newSpecifier;
  
    // SELECTOR TABLES; these supply specifier proxies with valid selector methods according to what they specify
    // (property/single element/multiple elements/insertion; plus comparison+containment/logic tests)
    Object.assign(this, aeselectors.targetedAppRootTables);

  }
  
  // TO DO: decide introspection
  
  [Symbol.toString]() { 
    return `[AppData ${this.targetID}]`;
  }
  
  [Symbol.toPrimitive](hint) {
    return aesupport.isNumber(hint) ? Number.NaN : `[AppData ${this.targetID}]`;
  }
  
  [util.inspect.custom]() {
    return `[AppData ${this.targetID}]`;
  }
  
  target() {
    if (!this._targetDescriptor) {
      let desc;
      switch (this.targetType) {
      case "named":
      {
        if (!aesupport.isString(this.targetID)) {
          throw new TypeError(`app.named(...) requires a name/path string but received ${typeof this.targetID}: ${util.inspect(this.targetID)}`);
        }
        const url = aesupport.fileURLForLocalApplication(this.targetID);
        if (!url) {
          throw new aeerrors.ConnectionError(`Application not found: ${util.inspect(this.targetID)}`, -10814); // TO DO: not sure about this error number
        }
        desc = processDescriptorForLocalApplication(url, this.workspaceLaunchOptions);
        break;
      }
      case "at": // eppc: URL
      {
        if (!aesupport.isString(this.targetID)) {
          throw new TypeError(`app.at(...) requires an "eppc:" URL string but received ${typeof this.targetID}: ${util.inspect(this.targetID)}`);
        }
        const url = objc.NSURL.URLWithString_(this.targetID);
        if (!url || objc.js(url.scheme()).toLowerCase() !== 'eppc') {
          throw new TypeError(`app.at(...) requires an "eppc:" URL but received: ${util.inspect(this.targetID)}`);
        }
        desc = objc.NSAppleEventDescriptor.descriptorWithApplicationURL_(url);
        break;
      }
      case "ID":
        if (aesupport.isString(this.targetID)) { // bundleID
          const url = objc.NSWorkspace.sharedWorkspace().URLForApplicationWithBundleIdentifier_(this.targetID);
          if (!url) {
            throw new aeerrors.ConnectionError(`Application not found: ${util.inspect(this.targetID)}`, -10814); // TO DO: as above, not sure about error number
          }
          desc = processDescriptorForLocalApplication(url);
        } else if (aesupport.isNumber(this.targetID)) { // ProcessID
          try {
            desc = objc.NSAppleEventDescriptor.descriptorWithProcessIdentifier_(aesupport.SInt32(this.targetID));
          } catch(e) { // catch out-of-bounds errors from SInt32()
            throw new TypeError(`app.ID(...) received bad process ID number: ${this.targetID}`);
          }
        } else if (aesupport.isNSAppleEventDescriptor(this.targetID)) {
          desc = this.targetID; // caution: it is user's responsibility to ensure supplied descriptor is a valid AEAddressDesc
        } else {
          throw new TypeError(`app.ID(...) requires bundle ID string, process ID number, or NSAppleEventDescriptor containing an address descriptor but received: ${util.inspect(this.targetID)}`);
        }
        break;
      case "currentApplication":
        desc = objc.NSAppleEventDescriptor.currentProcessDescriptor();
        break;
      default:
        throw new TypeError(`Bad target type: "${this.targetType}"`);
      }
      // flatten the AEDesc
      this._targetDescriptor = flattenNSAppleEventDescriptor(desc).subarray(8); // omit 'dle2' header
    }
    return this._targetDescriptor;
  }
  
  isRunning() {
    switch (this.targetType) {
    case 'named': // application's name (.app suffix is optional) or full path
    {
      const url = aesupport.fileURLForLocalApplication(this.targetID);
      return Boolean(url && processForLocalApplication(url));
    }
    case 'at': // "eppc" URL
    {
      const url = objc.NSURL.URLWithString_(url);
      return isRunningWithAddressDescriptor(objc.NSAppleEventDescriptor.descriptorWithApplicationURL_(url));
    }
    case 'ID':
      if (aesupport.isString(this.targetID)) { // bundleID
        return objc.NSRunningApplication.runningApplicationsWithBundleIdentifier_(this.targetID).count() !== 0;
      } else if (aesupport.isNumber(this.targetID)) { // ProcessID
        return Boolean(objc.NSRunningApplication.runningApplicationWithProcessIdentifier_(this.targetID));
      } else { // AEAddressDesc
        return isRunningWithAddressDescriptor(this.targetID);
      }
    }
    return true; // currentApplication
  }
  
  
  isRelaunchable(commandDef) { // only local apps targeted by name/path/bundleID can be automatically relaunched
    return (this.targetType === 'named' || (this.targetType === 'ID' && aesupport.isString(this.targetID))) &&
      (this.relaunchMode === kRelaunchModes.always || (this.relaunchMode === kRelaunchModes.limited 
              && kLimitedRelaunchEvents.includes(`${commandDef.eventClass}/${commandDef.eventID}`)));
  }
  
  
  isRunningWithAddressDescriptor(desc) {
    return !kProcessNotFoundErrorNumbers.includes(this._sendLaunchEvent(desc));
  }

  //
  
  _sendAppleEvent(aeBuffer, sendOptions, timeout) { // used by sendAppleEvent()
    // returns [null, OSStatus] on AEM errors (-1712 'event timed out', -600 'process not found', etc)
    // (note: application errors are reported via the reply event, not by AEM)
    
    const aeDesc = aeBuffer.toAEDesc();
    const replyDesc = new AEDesc({descriptorType: kae.typeNull, dataHandle: null}).ref();
    const err = aem.AESendMessage(aeDesc, replyDesc, sendOptions, timeout);
    /*
    // TO DO:
    if (sendOptions & kSendOptions.queueReply) { // return the returnID attribute that the reply event will use to identify itself when it arrives in host process's event queue (note: this design may change if implementing async callbacks)
      // TO DO: need to get this attribute back out of event AEDesc after it's been sent
      const returnID = event.attributeDescriptorForKeyword_(kae.keyReturnIDAttr)?.int32Value?.();
      if (!returnID) { // sanity check
        throw new aeerrors.ParameterError(null, "Can't get keyReturnIDAttr from reply event");
      }
      return returnID;
    }
    */
    aem.AEDisposeDesc(aeDesc);
    if (err) {
      return [null, err];
    } else {
      //console.log(objc.NSAppleEventDescriptor.alloc().initWithAEDescNoCopy_(replyDesc))
      const replyEvent = flattenAEDesc(replyDesc);
      aem.AEDisposeDesc(replyDesc);
      return [replyEvent, 0];
    }
  }
  
  //
  
  _sendLaunchEvent(processDescriptor) { // returns error code (except -1708, which is ignored)
    const event = objc.NSAppleEventDescriptor
        .appleEventWithEventClass_eventID_targetDescriptor_returnID_transactionID_(
                                kae.kASAppleScriptSuite, 
                                kae.kASLaunchEvent,
                                processDescriptor, 
                                kae.kAutoGenerateReturnID,
                                kae.kAnyTransactionID);
    const error = new objc.Ref();
    const replyEvent = event.sendEventWithOptions_timeout_error_(kSendOptions.waitReply, 30, error);
    if (!replyEvent) { return error.value?.code?.() ?? 1; }
    const errorDesc = replyEvent.paramDescriptorForKeyword_(kae.keyErrorNumber);
    // `ascrnoop` events normally return 'handler not found' (-1708) errors, so ignore those
    return (errorDesc && errorDesc.int32Value() !== -1708) ? errorDesc.int32Value() : 0;
  }
  
  // TO DO: `launch` needs a rethink
  
  launch() { // called by Application.launch()
    // launch this application (equivalent to AppleScript's `launch` command; an obscure corner case that AS users need to fall back onto when sending an event to a Script Editor applet that isn't saved as 'stay open', so only handles the first event it receives then quits when done) // TO DO: is it worth keeping this for 'quirk-for-quirk' compatibility's sake, or just ditch it and tell users to use `NSWorkspace.launchApplication(at:options:configuration:)` with an `NSWorkspaceLaunchConfigurationAppleEvent` if they really need to pass a non-standard first event?
    // note: in principle an app _could_ implement an AE handler for this event that returns a value, but it probably isn't a good idea to do so (the event is called 'ascr'/'noop' for a reason), so even if a running process does return something (instead of throwing the expected errAEEventNotHandled) we just ignore it for sanity's sake (the flipside being that if the app _isn't_ already running then NSWorkspace.launchApplication() will launch it and pass the 'noop' descriptor as the first Apple event to handle, but doesn't return a result for that event, so to return a result at any other time would be inconsistent)
    //console.log('is running:', this.isRunning()); // DEBUG
    if (this.isRunning()) {
      const errorNumber = this._sendLaunchEvent(this.target()); // WRONG
      if (errorNumber !== 0) { throw new aeerrors.AppleEventManagerError(errorNumber); } // TO DO: not right
    } else {
      switch (this.targetType) {
      case 'named':
      {
        const url = aesupport.fileURLForLocalApplication(this.targetID);
        if (!url) {
          throw new aeerrors.ConnectionError(`Can't launch application named ${util.inspect(this.targetID)}: Application not found.`, -10814);
        }
        launchApplicationAtURL(url); // throws on failure
        return;
      }
      case 'at':
        // TO DO: NA doesn't do file URLs and eppc URLs can't launch; all we can do is send it RAE (but need to check if that's what AS does)
        //launchApplicationAtURL(objc.NSURL.URLWithString_(this.targetID));
        throw new Error('TBC');
        return;
      case 'ID':
      {
        if (!aesupport.isString(this.targetID)) {
          throw new aeerrors.ConnectionError(`Can't launch application with process ID ${util.inspect(this.targetID)}: Application not found.`, number);
        }
        const url = NSWorkspace.sharedWorkspace().urlForApplicationWithBundleIdentifier_(this.targetID);
        if (!url) {
          throw new aeerrors.ConnectionError(`Can't launch application with bundle ID ${util.inspect(this.targetID)}: Application not found.`, -10814);

        }
        launchApplicationAtURL(url);
        return;
      }
      default:
        throw new aeerrors.ConnectionError("Can't launch application.", -10814); // TO DO: what error message/number to use here?
      }
    }
  }
  
  
  /************************************************************************************/
  // AE DISPATCH
  
  
  _readParametersObject(commandDef, parametersObject, parentSpecifierRecord) {
    let directParameter = aesupport.kNoParameter;
    let sendOptions = kDefaultSendOptions, timeout = kAEDefaultTimeout;
    let consideringIgnoring = kDefaultIgnoringDescriptors;
    const attributes = Object.create(null), parameters = Object.create(null);
    for (let [key, value] of Object.entries(parametersObject)) {
      const paramCode = commandDef.params[key];
      if (paramCode !== undefined) {
        parameters[paramCode] = value;
      } else {
        switch(key) {
        case "_":
          directParameter = value;
          break;
        case "asType": // must be keyword
          if (!(value instanceof aesupport.Keyword)) {
            throw new aeerrors.ParameterError(value, 'Bad asType attribute (not a keyword)');
          }
          parameters[kae.keyAERequestedType] = value;
          break;
        case "sendOptions": // all send flags; [array of] keywords, e.g. [k.ignoreReply,...]
          sendOptions = readSendOptions(value);
          break;
        case "withTimeout": 
          if (value !== null) { // users can pass `null` to indicate default timeout (120sec)
            try {
              timeout = aesupport.SInt32(value);
            } catch(e) {
              throw new aeerrors.ParameterError(value, "Bad timeout attribute (not an integer or null)");
            }
            timeout = timeout > 0 ? timeout * 60 : kNoTimeOut; // convert seconds to ticks
          }
          break;
        case "ignoring": // text attributes to consider/ignore (if supported by app); [array of] keywords
          consideringIgnoring = readIgnoringOptions(value);
          break;
        default: // if four-char code (e.g. '#docu', '0x646f6375') pack as param, else throw 'unknown'
          let rawParamCode;
          // TO DO: what about `$#code` for attributes?
          try {
            rawParamCode = aesupport.parseFourCharCode(key); 
          } catch(e) {
            throw new aeerrors.ParameterError(value, `Unknown parameter: "${key}"`);
          }
          parameters[rawParamCode] = value;
        }
      }
    }
    attributes[kae.enumConsiderations] = consideringIgnoring.ignoresList;
    attributes[kae.enumConsidsAndIgnores] = consideringIgnoring.considerIgnoreFlags;
    // special-case where command os called on a specifier, e.g. SPECIFIER.COMMAND() -> APP.COMMAND(_:SPECIFIER)
    let subjectAttribute = aeselectors.kAppRootDesc; // default subject is typeNull descriptor (`app`)
    if (parentSpecifierRecord.form !== aesupport.kSpecifierRoot) {
      const appData = this;
      const parentSpecifier = {
        [util.inspect.custom]: function() {
          return aeformatter.formatSpecifierRecord(appData, parentSpecifierRecord);
        },
        [Symbol.toPrimitive]: function(hint) {
          return hint === 'number' ? Number.NaN 
                       : aeformatter.formatSpecifierRecord(appData, parentSpecifierRecord);
        },
        [aesupport.__packSelf]: function(aeBuffer, appData) {
          parentSpecifierRecord.pack(aeBuffer, appData, parentSpecifierRecord);
        }
      };
      if (commandDef.eventClass === kae.kAECoreSuite && commandDef.eventID === kae.kAECreateElement) {
        // special-case shortcut for `make` (this uses parentSpecifier as `at` instead of direct param)
        if (parameters[kae.keyAEInsertHere] === undefined) {
          parameters[kae.keyAEInsertHere] = parentSpecifier;
        } else {
          subjectAttribute = parentSpecifier;
        }
      } else {
        if (directParameter === aesupport.kNoParameter) {
          directParameter = parentSpecifier;
        } else {
          subjectAttribute = parentSpecifier;
        }
      }
    }
    attributes[kae.keySubjectAttr] = subjectAttribute;
    if (directParameter !== aesupport.kNoParameter) {
      parameters[kae.keyDirectObject] = directParameter;
    }
    return {attributes, parameters, sendOptions, timeout};
  }
  
  
   
  _packAppleEvent(commandDef, addressDesc, attributes, parameters, sendOptions, timeout) {
    // commandDef
    // addressDesc : AEOpaqueDescriptor -- e.g. typeKernelProcessID
    // attributes : {OSType:any}
    // parameters : {OSType:any}
    // sendOptions : UInt32
    // timeout : integer -- timeout in seconds, or k
    const event = new AEDescriptorBuffer(); // starts with 'dle2'
    event.writeUInt32BE(kae.typeAppleEvent);
    const dataSizeOffset = event.allocate(4); // data size
    const dataSizeStart = event.offset;
    event.writeUInt32BE(0);
    event.writeUInt32BE(0);
    const parametersJumpOffset = event.allocate(4); // offset to parameters (from start of data)
    event.writeUInt32BE(4);
    const parametersCountOffset = event.allocate(4); // parameter count
    event.writeUInt32BE(0);
    event.writeUInt32BE(0);
    event.writeUInt32BE(0);
    event.writeUInt32BE(commandDef.eventClass); // event class and ID
    event.writeUInt32BE(commandDef.eventID);
    event.writeUInt16BE(0);
    event.writeInt16BE(kae.kAutoGenerateReturnID); // return ID
    event.fill(0, 84); // unused
    event.writeUInt32BE(kae.typeAppleEvent); // repeated
    event.writeUInt32BE(0x00010001); // version marker
    // begin attributes
    // target process
    event.writeUInt32BE(kae.keyAddressAttr);
    event.addressDescStartOffset = event.offset; // if target process has quit since addressDesc was created, allow it to be retargeted; addressDesc in this case should be typeKernelProcessID, which is fixed size so can be updated with a single `writeInt32BE(newPID, addressDescEndOffset - 4)`, but we should check to be sure
    event.writeBuffer(addressDesc);
    event.addressDescEndOffset = event.offset;
    // return address for reply events (host process's PID)
    event.writeUInt32BE(kae.keyOriginalAddressAttr);
    event.writeUInt32BE(kae.typeKernelProcessID);
        event.writeUInt32BE(4);
        event.writeInt32BE(process.pid); // pid_t = SInt32
        // interaction level // neverInteract/canInteract/alwaysInteract
    event.writeUInt32BE(kae.keyInteractLevelAttr); // AESendMessage will update this value
        event.writeUInt32BE(kae.typeSInt32); // dunno why it's a signed int, but it's copied from AEFlattenDesc output
        event.writeUInt32BE(4);
        event.writeInt32BE(sendOptions & kInteractionLevelMask); // UInt8
        // reply requested? // 1/0
    event.writeUInt32BE(kae.keyReplyRequestedAttr); // AESendMessage will update this value
        event.writeUInt32BE(kae.typeSInt32);
        event.writeUInt32BE(4);
    const wantsReply = (sendOptions & kWantsReplyMask);
        event.writeInt32BE(wantsReply === kSendOptions.wantsReply || wantsReply === kSendOptions.queueReply ? 1 : 0); // UInt8 // kAEWaitForReply/kAEQueueReply = true; kAENoReply = false
        // timeout (this is passed to target process for its info and should be same as timeout passed to AESendMessage)
        event.writeUInt32BE(kae.keyTimeoutAttr);
        event.writeUInt32BE(kae.typeSInt32);
        event.writeUInt32BE(4);
        event.writeInt32BE(timeout);
    for (let [key, value] of Object.entries(attributes)) {
      //console.log(`ATTR: ${aesupport.formatFourCharCode(key)} <${value}>`);
          event.writeUInt32BE(key);
          this._writeDescriptor(event, value); // no error trapping as attributes should already be valid
    }
    event.writeUInt32BE(0x3b3b3b3b); // end of attributes ';;;;'
    const parametersJumpEnd = event.offset;
    event.rawBuffer.writeUInt32BE(parametersJumpEnd - dataSizeStart, parametersJumpOffset);
    let parametersCount = 0;
    for (let [key, value] of Object.entries(parameters)) {
      //console.log(`PARM: ${aesupport.formatFourCharCode(key)} <${value}>`);
          event.writeUInt32BE(key);
          try {
        this._writeDescriptor(event, value);
      } catch (e) {
        if (key === kae.keyDirectObject) {
          key = 'direct';
        } else {
          key = `'${aeformatter.paramNamesByCode(commandDef)[key] ?? aesupport.formatFourCharCode(key)}'`;
        }
        let msg = `Bad '${key}' parameter`;
        //console.log(util.inspect(e))
        //console.log(e.stack)
        //console.log(e.parentError?.stack)
        if (e instanceof aeerrors.PackError) { msg += `: can't pack ${typeof value} as descriptor`; }
        throw new aeerrors.ParameterError(value, msg + `: ${e}`, e); // TO DO: sort out error chaining
      }
          parametersCount++;
    }
    event.rawBuffer.writeUInt32BE(parametersCount, parametersCountOffset);
    const dataSizeEnd = event.offset;
    event.rawBuffer.writeUInt32BE(dataSizeEnd - dataSizeStart, dataSizeOffset);
    return event;
  }
  
  
  sendAppleEvent(commandDef, parentSpecifierRecord, parametersObject) {
    let replyEvent = null, errorCode = 0;
    try {
      if (typeof parametersObject !== 'object') {
        throw new TypeError(
          `Bad command argument: expected a parameters object but received ${typeof parametersObject}.`);
      }
      const addressDesc = this.target();
      const {attributes, parameters, sendOptions, timeout} = this._readParametersObject(commandDef, 
                                                parametersObject,
                                                parentSpecifierRecord);  
      const eventBuffer = this._packAppleEvent(commandDef, addressDesc, 
                           attributes, parameters, sendOptions, timeout);
      
      // send the AppleEvent
      [replyEvent, errorCode] = this._sendAppleEvent(eventBuffer, sendOptions, timeout);      
      if (sendOptions & kSendOptions.noReply) { return null; }
      
      // check for errors raised by Apple Event Manager (e.g. timeout, process not found)
      if (!replyEvent) {
        if (kRelaunchableErrorCodes.includes(errorCode) && this.isRelaunchable(commandDef)) {
          // event failed as target process has quit since previous event; recreate AppleEvent with new a address descriptor and resend (non-recursive so will permanently error if resend also fails)
          this._targetDescriptor = null; // discard the old address desc
          const newAddressDesc = this.target(); // create a new address desc
          if (newAddressDesc.size === eventBuffer.addressDescEndOffset - eventBuffer.addressDescStartOffset) {
            const endOffset = eventBuffer.offset;
            eventBuffer.offset = eventBuffer.addressDescStartOffset;
            newAddressDesc[aesupport.__packSelf](eventBuffer, this);
            eventBuffer.offset = endOffset;
          }
          [replyEvent, errorCode] = this._sendAppleEvent(eventBuffer, sendOptions, timeout);
        }
        if (errorCode) { throw new aeerrors.AppleEventManagerError(errorCode); }
      }
      if (sendOptions & kWantsReplyMask === kSendOptions.queueReply) {
        return replyEvent; // replyEvent is returnID
      } else {
        return this.unpackReplyEvent(replyEvent, sendOptions);
      }
    } catch (parentError) { // rethrow all errors as CommandError
      throw new aeerrors.CommandError(this, commandDef, parentSpecifierRecord, parametersObject, parentError);
    }
  }
  
  
  unpackReplyEvent(replyEvent, sendOptions) { // unpack application error/result, if any
    // To return raw reply events, construct `app` object as normal then patch its AppData as follows:
    //
    //   const someApp = app(...);
    //   someApp[aesupport.__appData].unpackReplyEvent = function(replyEvent,sendOptions){return replyEvent;};
    //   const replyEvent = someApp.someCommand(...); // -> <NSAppleEventDescriptor: 'aevt'\'ansr'{...}>
    //

    const rawBuffer = replyEvent instanceof Buffer ? replyEvent 
                             : flattenAEDesc(replyEvent.aeDesc().value.aedesc.ref());
    rawBuffer.aeoffset = 8;
    const descriptorType = rawBuffer.readUInt32BE(rawBuffer.aeoffset);
    if (descriptorType === kae.typeNull) { return null; }
    if (descriptorType !== kae.typeAppleEvent) { throw new aeerrors.UnpackError(replyEvent); }
    rawBuffer.aeoffset += 4;
    const dataSize = rawBuffer.readUInt32BE(rawBuffer.aeoffset);
    rawBuffer.aeoffset += 4;
    const dataStartOffset = rawBuffer.aeoffset;
    const expectedEndOffset = dataStartOffset + dataSize;
    rawBuffer.aeoffset += 8; // 2x reserved
    const parametersStartOffset = dataStartOffset + rawBuffer.readUInt32BE(rawBuffer.aeoffset);
    rawBuffer.aeoffset += 8; // offset + reserved
    const parametersCount = rawBuffer.readUInt32BE(rawBuffer.aeoffset);
    rawBuffer.aeoffset = parametersStartOffset;
    const endOfAttributes = rawBuffer.readUInt32BE(rawBuffer.aeoffset - 4);
    if (endOfAttributes !== 0x3b3b3b3b) {
      throw new Error(`Expected end of attributes at ${rawBuffer.aeoffset - 4} but found ${aesupport.formatFourCharCode(endOfAttributes)}`);
    }
    const reply = Object.create(null);
    for (let i = 0; i < parametersCount; i++) {
      const key = rawBuffer.readUInt32BE(rawBuffer.aeoffset);
      rawBuffer.aeoffset += 4;
      reply[key] = this._readDescriptor(rawBuffer);
    }
    if (rawBuffer.aeoffset !== expectedEndOffset) {
      throw new Error(`expected ${expectedEndOffset} bytes, read ${rawBuffer.aeoffset}`);
    }
    if (sendOptions & kSendOptions.waitReply) {
      const errorNumber = reply[kae.keyErrorNumber];
      if (errorNumber) { // an application error occurred (also ignore 0 = noErr)
        throw new aeerrors.ApplicationError(reply);
      } else {
        return reply[kae.keyDirectObject] ?? null;
      }
    }
    return null; // application returned no result
  }

  
  /************************************************************************************/
  // PACK
  
  // Note: to pack/unpack unknown JS values/AEDescs, monkey-patch the pack/unpack methods below to process those types first before delegating to original pack/unpack methods. // TO DO: does this still hold? (even if it does, it may not be a good way to do it given the internal change from OO NSAppleEventDescriptors to stream Buffers)
  
  
  _writeDescriptor(aeBuffer, value, hasHeader = false) {
    // similar to AEStream*, but atomic and writes flattened descriptor to buffer (ideally we'd write directly to a Mach message buffer, but we'd need to reverse-engineer low-level AEM APIs)
    if (value === null) {
      aeBuffer.writeUInt32BE(kae.typeType);
      aeBuffer.writeUInt32BE(4); // data size
      aeBuffer.writeUInt32BE(kae.cMissingValue);

    } else if (aesupport.isBoolean(value)) {
      aeBuffer.writeUInt32BE(value ? kae.typeTrue : kae.typeFalse);
      aeBuffer.writeUInt32BE(0); // data size
    
    } else if (aesupport.isNumber(value)) {
      if (value % 1 === 0 && value >= aesupport.SINT32_MIN && value <= aesupport.SINT32_MAX) {
        aeBuffer.writeUInt32BE(kae.typeSInt32);
        aeBuffer.writeUInt32BE(4); // data size
        aeBuffer.writeInt32BE(value);
      } else {
        aeBuffer.writeUInt32BE(kae.typeIEEE64BitFloatingPoint);
        aeBuffer.writeUInt32BE(8); // data size
        aeBuffer.writeDoubleBE(value);
      }
    
    } else if (aesupport.isString(value)) {
      // typeUnicodeText = native endian with optional BOM
      // typeUTF16ExternalRepresentation = UTF16 with optional byte-order-mark 
      //                   OR little-endian UTF16 with required byte-order-mark
      // Buffer.write has 'utf8' and 'utf16le' options, but no 'utf16be' option
      // caution: Photoshop rejects typeUTF8Text with (misleading) -1728 error, so must pack as typeUnicodeText
      /*
      aeBuffer.writeUInt32BE(kae.typeUTF8Text);
      const dataSizeOffset = aeBuffer.allocate(4); // data size (TBC)
      const bytesWritten = aeBuffer.writeUTF8(value); // write string, getting back its size in bytes
      aeBuffer.rawBuffer.writeUInt32BE(bytesWritten, dataSizeOffset); // write data size
      */
      aeBuffer.writeUInt32BE(kae.typeUnicodeText);
      const dataSizeOffset = aeBuffer.allocate(4); // data size (TBC)
      const bytesWritten = aeBuffer.writeUTF16BE(value); // write string, getting back its size in bytes
      aeBuffer.rawBuffer.writeUInt32BE(bytesWritten, dataSizeOffset); // write data size
    
    } else if (value instanceof Object) {
      if (value instanceof Date) {
        aeBuffer.writeUInt32BE(kae.typeLongDateTime);
        aeBuffer.writeUInt32BE(8); // data size
        aeBuffer.writeInt64BE(((Number(value) + DATE_OFFSET) / 1000).toFixed());
      
      } else if (value instanceof Array) {
        aeBuffer.writeUInt32BE(kae.typeAEList);
        const dataSizeOffset = aeBuffer.allocate(4); // data size (TBC)
        const dataStartOffset = aeBuffer.offset;
        if (hasHeader) { // flattened 'list' has extra header
          aeBuffer.writeUInt32BE(0); // reserved
          aeBuffer.writeUInt32BE(0); // 4-byte padding
          aeBuffer.writeUInt32BE(0x18); // reserved
          aeBuffer.writeUInt32BE(kae.typeAEList); // repeated type
        }
        aeBuffer.writeUInt32BE(value.length); // count of items in list
        aeBuffer.writeUInt32BE(0); // 4-byte padding
        for (let item of value) {
          this._writeDescriptor(aeBuffer, item);
        }
        aeBuffer.rawBuffer.writeUInt32BE(aeBuffer.offset - dataStartOffset, dataSizeOffset); // write data size
      
      } else if (value[aesupport.__packSelf]) { // Keyword, Specifier
        value[aesupport.__packSelf](aeBuffer, this);
      
      } else if (objc.isInstance(value)) { // objc compatibility
        if (value.isKindOfClass_(objc.NSAppleEventDescriptor)) {
          const rawBuffer = flattenAEDesc(value.aeDesc().value.ref());
          const startOffset = aeBuffer.allocate(rawBuffer.length - 8);
          rawBuffer.copy(aeBuffer.rawBuffer, startOffset, 8); // skip 'dle2' header
        } else {
          const jsValue = objc.js(value, (v) => { throw new TypeError(`Can't pack ObjC value: ${v}`) });
          this._writeDescriptor(aeBuffer, jsValue, hasHeader);
        }
        
      } else if (value.constructor.name === 'Object') { // record // TO DO: this also matches objc Proxy
        let descriptorType = kae.typeAERecord;
        // need to determine if it's kAERecord so that header can be added if needed; this is made unpleasant in that there are several ways to specify a 'class' property key: name string, four-char code string, or hex/decimal UInt32
        const cls = value['class'] ?? value['#pcls'] ?? value['0x70636C73'] ?? value ['1885564019'];
        if (cls instanceof aesupport.Keyword) {
          const name = cls.name;
          if (aesupport.isNumber(name)) {
            descriptorType = name;
          } else {
            descriptorType = this.typeCodeForName(name)?.code;
            if (descriptorType === undefined) { throw new Error(`Unknown type: k.${name}`); }
          }
        }
        aeBuffer.writeUInt32BE(descriptorType);
        const dataSizeOffset = aeBuffer.allocate(4); // alloc UInt32 to hold remaining bytes
        const dataStartOffset = aeBuffer.offset;
        if (hasHeader && descriptorType === kae.typeAERecord) { // flattened 'reco' has extra header
          aeBuffer.writeUInt32BE(0); // reserved
          aeBuffer.writeUInt32BE(0); // 4-byte padding
          aeBuffer.writeUInt32BE(0x18); // reserved
          aeBuffer.writeUInt32BE(kae.typeAERecord); // repeated type
        }
        const countOffset = aeBuffer.allocate(4); // alloc UInt32 to hold count of items in record
        aeBuffer.writeUInt32BE(0); // 4-byte padding
        let count = 0, userProperties = [];
        // caution: this does not check for duplicate properties (since it is possible for one property's name to match another's four-char code)
        for (let [key, item] of Object.entries(value)) {
          if (!aesupport.isString(key)) {
            throw new TypeError(`Expected string key, got ${typeof key}: ${value}`);
          }
          if (key[0] === '$') { // user-defined key
            userProperties.push(key.slice(1));
            userProperties.push(item);
          } else if (descriptorType === kae.typeAERecord || 
                !['class', '#pcls', '0x70636C73', '1885564019'].includes(key)) { // write anything except a 'class' property that contains a Keyword, e.g. {class:k.document,...} will set descriptorType to cDocument, whereas {class:0,...} will pack `0` as `#pcls`
            let code = this.typeCodeForName(key)?.code;
            if (code === undefined) {
              try {
                code = aesupport.parseFourCharCode(key);
              } catch (e) {
                throw new Error(`Unknown property name '${key}' in: ${util.inspect(value)}`);
              }
            }
            aeBuffer.writeUInt32BE(code);
            this._writeDescriptor(aeBuffer, item);
            count++;
          }
        }
        if (userProperties.length > 0) {
          aeBuffer.writeUInt32BE(kae.keyASUserRecordFields);
          this._writeDescriptor(aeBuffer, userProperties);
          count++;
        }
        aeBuffer.rawBuffer.writeUInt32BE(aeBuffer.offset - dataStartOffset, dataSizeOffset); // write data size
        aeBuffer.rawBuffer.writeUInt32BE(count, countOffset); // write count of items in record
        
      } else {
        throw new TypeError(`Expected simple object, got ${value.constructor.name}: ${util.inspect(value)}`);
      }
  
    } else {
      throw new TypeError(`Can't pack unsupported type (${typeof value}): ${util.inspect(value)}`);
    }
  }
  
  pack(value) { // TO DO: needed?
    // value : JS value
    if (objc.isInstance(value)) {
      if (value.isKindOfClass_(objc.NSAppleEventDescriptor)) {
        return value;
      } else {
        value = objc.js(value, (v) => { throw new TypeError(`Can't pack ObjC value: ${v}`) });
      }
    }
    try {
      const aebuffer = new AEDescriptorBuffer();
      this._writeDescriptor(aebuffer, value, true);
      return aebuffer.toNSAppleEventDescriptor();
    } catch (e) {
      throw new aeerrors.PackError(value, e);
    }
  }
  
  
  /************************************************************************************/
  // UNPACK
  
  
  // TO DO: distinguish between known errors and unknown (i.e. bugs); PackError and UnpackError need [optional?] message arg
  
  _unpackFourCharCode(rawBuffer) {
    const type = rawBuffer.readUInt32BE(rawBuffer.aeoffset);
    rawBuffer.aeoffset += 4;
    const size = rawBuffer.readUInt32BE(rawBuffer.aeoffset);
    rawBuffer.aeoffset += 4;
    if (type !== kae.typeType && type !== kae.typeEnumerated || size  !== 4) {
      throw new Error(`Not a valid type/enum: ${aesupport.formatFourCharLiteral(type)}`); // TO DO: this should be UnpackError; ditto below
    }
    const code = rawBuffer.readUInt32BE(rawBuffer.aeoffset);
    rawBuffer.aeoffset += 4;
    return code;
  }
  
  
  _unpackSpecifierRecord(rawBuffer, expectedEndOffset, fullyUnpack) {
    try {
      let want, form, seld, from;
      const descriptorStartOffset = rawBuffer.aeoffset - 8;
      const count = rawBuffer.readUInt32BE(rawBuffer.aeoffset);
      if (count !== 4) {
        throw new Error(`Expected 4 properties, got ${count}`);
      }
      rawBuffer.aeoffset += 8; // step over count and 4-byte padding
      for (let i = 0; i < count; i++) {
        const code = rawBuffer.readUInt32BE(rawBuffer.aeoffset);
        rawBuffer.aeoffset += 4; // step over key
        switch (code) {
        case kae.keyAEDesiredClass:
          want = this._unpackFourCharCode(rawBuffer);
          break;
        case kae.keyAEKeyForm:
          form = this._unpackFourCharCode(rawBuffer);
          break;
        case kae.keyAEKeyData:
          seld = this._readDescriptor(rawBuffer, fullyUnpack);
          break;
        case kae.keyAEContainer:
          if (fullyUnpack) {
            from = this._readDescriptor(rawBuffer, fullyUnpack)[aesupport.__specifierRecord];
          } else { // defer recursive unpacking until/unless needed
            const fromDescStartOffset = rawBuffer.aeoffset; // descriptorType's offset
            rawBuffer.aeoffset += 4;
            const size = rawBuffer.readUInt32BE(rawBuffer.aeoffset); // read size
            rawBuffer.aeoffset += 4;
            const fromDescEndOffset = rawBuffer.aeoffset + size;
            const fromDesc = rawBuffer.subarray(fromDescStartOffset, fromDescEndOffset); // for now, this retains the original buffer underneath
            fromDesc.aeoffset = 0;
            rawBuffer.aeoffset = fromDescEndOffset;
            from = new Proxy({specifierRecord: undefined, appData: this, cachedDesc: fromDesc}, {
              get: function(object, name) {
                if (object.specifierRecord === undefined) { // fully unpack 'from' descriptor
                  const specifier = object.appData._readDescriptor(object.cachedDesc, true);
                  object.specifierRecord = specifier[aesupport.__specifierRecord];
                }
                return object.specifierRecord[name];
              }
            });
          }
          break;
        default:
          throw new Error(`Unknown property: '${aesupport.formatFourCharCode(code)}'`);
        }
        if (rawBuffer.aeoffset > expectedEndOffset) {
          throw new Error(`Expected AERecord (typeObjectSpecifier) to end on offset ${expectedEndOffset}, but item ${i} ended on ${rawBuffer.aeoffset}`);
        }
      }
      //console.log('_unpackSpecifierRecord', `{want:${aesupport.formatFourCharCode(want)}, form:${aesupport.formatFourCharCode(form)}, seld:${seld}, from:${util.inspect(from)}}`)
      if (want === undefined || form === undefined || seld === undefined || from === undefined) {
        throw new Error(`Missing property: {want:${want}, form:${form}, seld:${seld}, from:${util.inspect(from)}}`);
      }
      let selectors, call = aeselectors.getDataCommand;
      switch (form) {
      case kae.formPropertyID:
      case kae.formUserPropertyID:
        selectors = this.propertySpecifierAttributes;
        break;
      case kae.formAbsolutePosition:
        if (aesupport.isAllElementsEnum(seld)) {
          selectors = this.multipleElementsSpecifierAttributes;
          break;
        }
      case kae.formName:
      case kae.formUniqueID:
      case kae.formRelativePosition:
        selectors = this.singleElementSpecifierAttributes;
        break;
      case kae.formRange:
        // seld: {class:Keyword(kae.typeRangeDescriptor),[kae.keyAERangeStart]:...,[kae.keyAERangeStop]:...}
        // this check is arguably redundant if we assume descriptors are always well-formed
        if (seld?.class?.name !== kae.typeRangeDescriptor) { 
          throw new Error(`Invalid range specifier: ${util.inspect(seld)}`);
        }
        value = new aeselectors.Range(seld[kae.keyAERangeStart], seld[kae.keyAERangeStop], want);
        selectors = this.multipleElementsSpecifierAttributes;
        break;
      case kae.formTest:
        // this check is arguably redundant if we assume descriptors are always well-formed
        if (!aeselectors.isSpecifier(seld)) { // minimal check (this doesn't confirm it's its-based)
          throw new Error(`Invalid test specifier: ${util.inspect(seld)}`);
        }
        selectors = this.multipleElementsSpecifierAttributes;
        break;
      default:
        throw new Error(`Unknown form: ${aesupport.formatFourCharLiteral(form)}`);
      }
      if (rawBuffer.aeoffset !== expectedEndOffset) {
        throw new Error(`Expected AERecord (typeObjectSpecifier) to end on offset ${expectedEndOffset}, but ended on ${rawBuffer.aeoffset}`);
      }
      return {from,
          want,
          form,
          seld,
          selectors,
          cachedDesc: rawBuffer.subarray(descriptorStartOffset, expectedEndOffset),
          call: aeselectors.getDataCommand,
          pack: aeselectors.packCachedDesc};
    } catch (e) {
      //console.log(e.stack)
      throw new Error(`Can't unpack object specifier (malformed descriptor): ${e}`); // TO DO: UnpackError
    }
  }
  
  
  _unpackAERecord(rawBuffer, expectedEndOffset, fullyUnpack = false, hasHeader = false, rawKeys = false) {
    // aeoffset should be positioned immediately after descriptorType and size fields
    // note: this only unpacks the AERecord's properties; it does not add a 'class' property containing the actual descriptorType to returned object (caller can add a 'class' property to the returned object if needed)
    // rawBuffer.aeoffset should be positioned at end of record on return, or unchanged if an error occurred
     const dataStartOffset = rawBuffer.aeoffset; // store current offset to rollback if unpacking as AERecord fails
    const value = {}; // AERecord is analogous to a C struct
     try {
      if (hasHeader) { // flattened 'reco' has extra header
        rawBuffer.aeoffset += 16; // TO DO: should we validate any of these 4-byte fields?
      }
      //console.log(`DEBUG: Try unpacking descriptor of type '${aesupport.formatFourCharCode(rawBuffer.readUInt32BE(dataStartOffset - 8))}' as AERecord? (length=${rawBuffer.length}, from=${rawBuffer.aeoffset})`)
      const count = rawBuffer.readUInt32BE(rawBuffer.aeoffset);
      rawBuffer.aeoffset += 8; // step over count and 4-byte padding
      for (let i = 0; i < count; i++) {
        const code = rawBuffer.readUInt32BE(rawBuffer.aeoffset);
        rawBuffer.aeoffset += 4; // step over key
        if (code === kae.keyASUserRecordFields) {
          const items = this._readDescriptor(rawBuffer);
          if (!(items instanceof Array) || items.length % 2 !== 0) {
            throw new Error(`Bad value for keyASUserRecordFields`);
          }
          for (let i = 0; i < items.length; i += 2) {
            const key = items[i];
            if (!aesupport.isString(key)) {
              throw new Error(`Bad value for keyASUserRecordFields`);
            }
            value[`$${key}`] = items[i + 1];
          }
        } else {
          const key = rawKeys ? code : this.typeNameForCode(code)?.name ?? code;
          
          
          //let start = rawBuffer.aeoffset, typ = rawBuffer.readUInt32BE(rawBuffer.aeoffset);
          
          value[key] = this._readDescriptor(rawBuffer, fullyUnpack);
          
          //let end = rawBuffer.aeoffset;
          
          //console.log('unpack key', aesupport.formatFourCharLiteral(code), '=', aesupport.formatFourCharLiteral(typ), util.inspect(value[key] ?? value[`$${key}`]), `${start}...${end}`, 'bufsize:', rawBuffer.length)
        }
        if (rawBuffer.aeoffset > expectedEndOffset) {
          throw new Error(`Expected AERecord to end on offset ${expectedEndOffset}, but item ${i} ended on ${rawBuffer.aeoffset}`);
        }
      }
      if (rawBuffer.aeoffset !== expectedEndOffset) {
        throw new Error(`Expected AERecord to end on offset ${expectedEndOffset}, but ended on ${rawBuffer.aeoffset}`);
      }
    } catch (e) {
      //console.log(`DEBUG: Descriptor of type '${aesupport.formatFourCharCode(rawBuffer.readUInt32BE(dataStartOffset - 8))}' does not appear to be an AERecord:${e}`)
      rawBuffer.aeoffset = dataStartOffset; // restore offset
      throw new TypeError(`Not an AERecord: ${e}`); // Probably
    }
    return value;
  }
  
  
  // TO DO: what is rationale of unpacking insertionloc with these keys? keyAEObject='kobj', keyAEPosition='kpos'; not from/seld - currently this breaks formatter, which expects 4 std objspec keys

  _unpackInsertionLocRecord(rawBuffer, expectedEndOffset, fullyUnpack) {
    const descriptorStartOffset = rawBuffer.aeoffset - 8;
    const record = this._unpackAERecord(rawBuffer, expectedEndOffset, fullyUnpack, false, true);
    return {from: record[kae.keyAEObject],
        seld: record[kae.keyAEPosition],
        cachedDesc: rawBuffer.subarray(descriptorStartOffset, expectedEndOffset), 
        selectors: this.insertionSpecifierAttributes,
        call: aeselectors.doNotCall,
        pack: aeselectors.packCachedDesc};
  }

// unpack test clauses

  _unpackComparisonDescriptor(rawBuffer, expectedEndOffset, fullyUnpack) {
    const descriptorStartOffset = rawBuffer.aeoffset - 8;
    const record = this._unpackAERecord(rawBuffer, expectedEndOffset, fullyUnpack, false, true);
    const operator = record[kae.keyAECompOperator];
    const operand1 = record[kae.keyAEObject1];
    const operand2 = record[kae.keyAEObject2];
    
    // TO DO: Keyword is susceptible to app-defined type names overriding its four-char code, which will cause this test to fail; it'd be safer if Keyword had `name, type, code` arguments (or we could pass Keyword.name back through typeCodeForName to ensure it's an fcc)
    if (operand1 !== undefined && operand2 !== undefined && operator instanceof aesupport.Keyword 
                               && kComparisonOperatorCodes.has(operator.name)) {
      if (operator.name === kae.kAEContains && !aeselectors.isSpecifier(operand1)) {
        [operand1, operand2] = [operand2, operand1]; // op2.contains.op1 -> op1.isIn.op2
      }
      if (aeselectors.isSpecifier(operand1)) {
        return this.newSpecifier(this, {
            from: operand1[aesupport.__specifierRecord], // left operand
            form: operator.name, // operator
            seld: operand2, // right operand
            cachedDesc: rawBuffer.subarray(descriptorStartOffset, expectedEndOffset), 
            selectors: aeselectors.logicalTestConstructors,
            call: aeselectors.doNotCall,
            pack: aeselectors.packCachedDesc});
      }
    }
    throw new TypeError(`Can't unpack comparison test (malformed descriptor): ${util.inspect(record)}`);
  }

  _unpackLogicalDescriptor(rawBuffer, expectedEndOffset, fullyUnpack) {
    const descriptorStartOffset = rawBuffer.aeoffset - 8;
    const record = this._unpackAERecord(rawBuffer, expectedEndOffset, fullyUnpack, false, true);
    const operator = record[kae.keyAELogicalOperator];
    const operands = record[kae.keyAELogicalTerms];
    if (operands instanceof Array && operator instanceof aesupport.Keyword 
                    && (operator.name === kae.kAENOT && operands.length === 1 
                    || kLogicalOperatorCodes.has(operator.name) && operands.length > 1)) {
      const operand1 = operands.shift();
      return this.newSpecifier(this, {
          from: operand1[aesupport.__specifierRecord], // left operand
          form: operator.name, // operator
          seld: operands, // right operand[s]
          cachedDesc: rawBuffer.subarray(descriptorStartOffset, expectedEndOffset), 
          selectors: aeselectors.logicalTestConstructors,
          call: aeselectors.doNotCall,
          pack: aeselectors.packCachedDesc});
    }
    throw new TypeError(`Can't unpack logical test (malformed descriptor): ${util.inspect(record)}`);
  }

  //
  
  _readDescriptor(rawBuffer, fullyUnpack = false, hasHeader = false) {
    // important: rawBuffer must have an `aeoffset` property attached containing the offset from which to read it
    const descriptorStartOffset = rawBuffer.aeoffset;
    if (hasHeader) {
      const header = rawBuffer.readUInt32BE();
      if (header !== 0x646c6532) {
        throw new Error(`Expected flattened AEDesc (#dle2), got: ${aesupport.formatFourCharLiteral(header)}`);
      }
      rawBuffer.aeoffset += 8; // step over 'dle2\0\0\0\0'
    }
    const descriptorType = rawBuffer.readUInt32BE(rawBuffer.aeoffset);
    rawBuffer.aeoffset += 4; // step over descriptorType
    let value, size = rawBuffer.readUInt32BE(rawBuffer.aeoffset), bom;
    rawBuffer.aeoffset += 4; // step over size
    // now read descriptor's data (flattened dataHandle)
    let expectedEndOffset = rawBuffer.aeoffset + size;
    switch (descriptorType) {
    case kae.typeTrue:
      value = true;
      break;
    case kae.typeFalse:
      value = false;
      break;
    case kae.typeBoolean:
      value = rawBuffer.readUInt8(rawBuffer.aeoffset) !== 0;
      size++; // align on even byte
      expectedEndOffset++;
      rawBuffer.aeoffset += size; // TO DO: confirm 1 byte data then 1 alignment
      break;
    case kae.typeSInt32:
      value = rawBuffer.readInt32BE(rawBuffer.aeoffset);
      rawBuffer.aeoffset += 4;
      break;
    case kae.typeIEEE64BitFloatingPoint:
      value = rawBuffer.readDoubleBE(rawBuffer.aeoffset);
      rawBuffer.aeoffset += 8;
      break;
    case kae.typeUTF8Text:
      value = rawBuffer.toString('utf8', rawBuffer.aeoffset, expectedEndOffset);
      if (size % 2 !== 0) { // align on even byte
        size++;
        expectedEndOffset++;
      }
      rawBuffer.aeoffset += size;
      break;
    case kae.typeUnicodeText:
      // TO DO: according to AEDataModel.h, typeUnicodeText uses "native byte ordering, optional BOM"; however, the raw data in descriptors returned by Carbon/Cocoa apps appears to be big-endian UTF16 even on LE (x86_64) hardware, so use UTF16BE for now and figure out later
      bom = readBOM(rawBuffer);
      const tmpBuffer = Buffer.from(rawBuffer.subarray(rawBuffer.aeoffset, expectedEndOffset));
      if (bom !== 'LE') { tmpBuffer.swap16(); } // convert [what is assumed to be] UTF16 BE to LE
      value = tmpBuffer.toString('utf16le');
      rawBuffer.aeoffset += size;
      break;
    case kae.typeUTF16ExternalRepresentation:
      // typeUTF16ExternalRepresentation: big-endian 16 bit unicode with optional byte-order-mark OR 
      //                  little-endian 16 bit unicode with required byte-order-mark
      bom = readBOM(rawBuffer);
      if (bom === 'LE') {
        value = rawBuffer.toString('utf16le', rawBuffer.aeoffset, rawBuffer.aeoffset + size);
      } else { // BE
        const tmpBuffer = Buffer.from(rawBuffer, rawBuffer.aeoffset, size);
        tmpBuffer.swap16(); // convert to LE
        value = tmpBuffer.toString('utf16le');
      }
      rawBuffer.aeoffset += size;
      break;
    case kae.typeLongDateTime:
      value = new Date(rawBuffer.readInt64BE(rawBuffer.aeoffset) * 1000 - DATE_OFFSET);
      rawBuffer.aeoffset += 8;
      break;
    
    case kae.typeType:
    case kae.typeEnumerated:
    case kae.typeProperty:
    case kae.typeKeyword:
    {
      const code = rawBuffer.readUInt32BE(rawBuffer.aeoffset);
      value = code === kae.cMissingValue ? null : new aesupport.Keyword(this.typeNameForCode(code)?.name ?? code);
      rawBuffer.aeoffset += 4;
      break;
    }
    case kae.typeAEList:
    {
      if (hasHeader) { // flattened 'list' has extra header
        rawBuffer.aeoffset += 16; // TO DO: should we validate any of these 4-byte fields?
      }
      const count = rawBuffer.readUInt32BE(rawBuffer.aeoffset);
      value = Array(count);
      rawBuffer.aeoffset += 8; // step over count and 4-byte padding
      for (let i = 0; i < count; i++) {
        value[i] = this._readDescriptor(rawBuffer);
        if (rawBuffer.aeoffset > expectedEndOffset) {
          throw new Error(`Expected AEList to end on offset ${expectedEndOffset}, but item ${i} ended on ${rawBuffer.aeoffset}`);
        }
      }
      break;
    }
    case kae.typeAERecord:
      value = this._unpackAERecord(rawBuffer, expectedEndOffset, fullyUnpack, hasHeader);
      break;
        
    // Specifier
    
    case kae.typeObjectSpecifier:
      value = this.newSpecifier(this, this._unpackSpecifierRecord(rawBuffer, expectedEndOffset, fullyUnpack));
      break;
    case kae.typeInsertionLoc:
      return this.newSpecifier(this, this._unpackInsertionLocRecord(rawBuffer, expectedEndOffset, fullyUnpack));
    case kae.typeNull:
      value = aeselectors.newRootSpecifier(this);
      break;
    case kae.typeCurrentContainer:
      value = untargetedConRoot;
      break;
    case kae.typeObjectBeingExamined:
      value = untargetedItsRoot;
      break;
    case kae.typeAbsoluteOrdinal: // first/middle/last/any/all selector
      value = new aesupport.Keyword(rawBuffer.readUInt32BE(rawBuffer.aeoffset), kae.typeAbsoluteOrdinal);
      rawBuffer.aeoffset += 4;
      break;
    case kae.typeRangeDescriptor:
      // can't unpack to Range object here, as that needs to know `want` (or rather, we could unpack to Range here, but will need to assign its `want` later in _unpackObjectSpecifier)
      value = this._unpackAERecord(rawBuffer, expectedEndOffset, fullyUnpack, false, true);
      value.class = new aesupport.Keyword(kae.typeRangeDescriptor);
      break;
    case kae.typeCompDescriptor:
      value = this._unpackComparisonDescriptor(rawBuffer, expectedEndOffset, fullyUnpack);
      break;
    case kae.typeLogicalDescriptor:
      value = this._unpackLogicalDescriptor(rawBuffer, expectedEndOffset, fullyUnpack);
      break;

    // less commonly used AEDesc types
    
    case kae.typeQDPoint: // top,left -> [left,top]
      value = [rawBuffer.readInt16BE(rawBuffer.aeoffset+2), rawBuffer.readInt16BE(rawBuffer.aeoffset)];
      rawBuffer.aeoffset += 4;
      break;
    case kae.typeQDRectangle: // top,left,bottom,right -> [left,top,right,bottom]
      value = [rawBuffer.readInt16BE(rawBuffer.aeoffset+2), rawBuffer.readInt16BE(rawBuffer.aeoffset),
           rawBuffer.readInt16BE(rawBuffer.aeoffset+6), rawBuffer.readInt16BE(rawBuffer.aeoffset+4)];
      rawBuffer.aeoffset += 8;
      break;
    case kae.typeRGBColor: // [red,green,blue]
      value = [rawBuffer.readUInt16BE(rawBuffer.aeoffset),
           rawBuffer.readUInt16BE(rawBuffer.aeoffset+2),
           rawBuffer.readUInt16BE(rawBuffer.aeoffset+4)];
      rawBuffer.aeoffset += 6;
      break;
    
    case kae.typeSInt16:
      value = rawBuffer.readInt16BE(rawBuffer.aeoffset);
      rawBuffer.aeoffset += 2;
      break;
    case kae.typeUInt16:
      value = rawBuffer.readUInt16BE(rawBuffer.aeoffset);
      rawBuffer.aeoffset += 2;
      break;
    case kae.typeUInt32:
      value = rawBuffer.readUInt32BE(rawBuffer.aeoffset);
      rawBuffer.aeoffset += 4;
      break;
    case kae.typeSInt64:
      value = rawBuffer.readInt64BE(rawBuffer.aeoffset);
      rawBuffer.aeoffset += 8;
      break;
    case kae.typeUInt64:
      value = rawBuffer.readUInt64BE(rawBuffer.aeoffset);
      rawBuffer.aeoffset += 8;
      break;
    case kae.typeIEEE32BitFloatingPoint:
      value = rawBuffer.readFloatBE(rawBuffer.aeoffset);
      rawBuffer.aeoffset += 4;
      break;
      
    case kae.typeChar: // long-deprecated (but some Carbon apps still use it!)
      value = rawBuffer.toString('latin1', rawBuffer.aeoffset, expectedEndOffset); // not the correct type (which is host machine's primary encoding, e.g. "MacRoman" on English-language Macs), but it will do for now (TBH, simplest solution here is to pack, coerce to typeUnicodeText, and unpack that)
      if (size % 2 !== 0) { // align on even byte
        size++;
        expectedEndOffset++;
      }
      rawBuffer.aeoffset += size;
      break;

      
    case kae.typeFileURL: // TO DO: how best to convert POSIX path to/from file:// URL?
    {
      const path = objc.js(objc.NSURL.URLWithString_(rawBuffer.toString('utf8', rawBuffer.aeoffset)).path());
      value = new aesupport.File(path);
      if (size % 2 !== 0) { // align on even byte
        size++;
        expectedEndOffset++;
      }
      rawBuffer.aeoffset += size;
      break;
    }
    
    case kae.typeAlias:
    case kae.typeBookmarkData:
    case kae.typeFSRef:
    {
      const aeBuffer = new AEDescriptorBuffer();
      aeBuffer.writeBuffer(rawBuffer.subarray(rawBuffer.aeoffset - 8, rawBuffer.aeoffset + size));
      const urlDesc = aeBuffer.toNSAppleEventDescriptor()?.coerceToDescriptorType_(kae.typeFileURL);
      if (!urlDesc) {
        throw new Error(`Failed to unpack ${aesupport.formatFourCharLiteral(descriptorType)} descriptor.`);
      }
      value = this.unpack(urlDesc);
      rawBuffer.aeoffset += size;
      break;
    }
    
    default:
      try { // is it an AERecord with custom descriptorType? only way to find out is to try to unpack it as 'reco'
        value = this._unpackAERecord(rawBuffer, expectedEndOffset, fullyUnpack); // note: flattened AERecords with a non-'reco' type do not have the extra header
        value.class = new aesupport.Keyword(this.typeNameForCode(descriptorType)?.name ?? descriptorType);
      } catch (e) { // unknown descriptorType
        const buffer = rawBuffer.subarray(descriptorStartOffset, expectedEndOffset);
        value = new aesupport.AEOpaqueDescriptor(buffer);
        if (expectedEndOffset % 2 !== 0) { // align on even byte
          expectedEndOffset++;
        }
        //console.log(`DEBUG: wrapped non-unpackable descriptor of type ${aesupport.formatFourCharLiteral(descriptorType)}, size ${expectedEndOffset-descriptorStartOffset}, ends on ${expectedEndOffset}; error was: ${e}`);
        //console.log('>>>', e.stack)
        rawBuffer.aeoffset = expectedEndOffset;
      }
    }
    // DEBUG: sanity checks in case of bugs in above buffer-reading code
    if (expectedEndOffset % 2 !== 0) {
      throw new Error(`BUG: _readDescriptor failed to align on an even byte: ${expectedEndOffset}`);
    }
    if (expectedEndOffset !== rawBuffer.aeoffset) {
      throw new Error(`BUG: Expected ${aesupport.formatFourCharLiteral(descriptorType)} descriptor to end on byte ${expectedEndOffset} but ended on ${rawBuffer.aeoffset}`);
    }
    return value;
  }
  
  
  unpack(descriptor, fullyUnpack = false) {
    // descriptor : NSAppleEventDescriptor
    // fullyUnpack : boolean
    // Result: anything
    try {
      const aedescRef = descriptor.aeDesc();
      // TO DO: AESizeOfFlattenedDesc segfaults if we pass the Ref object directly; how to make Ref compatible with ref-napi's 'pointer'?
      const rawBuffer = flattenAEDesc(aedescRef.value.ref());
      rawBuffer.aeoffset = 0;
      return this._readDescriptor(rawBuffer, fullyUnpack, true);
    } catch (e) { // descriptor is incorrectly formed or there is a bug in deserialization code above
      throw new aeerrors.UnpackError(descriptor, e);
    }
  }
  
  
  /************************************************************************************/
  // TERMINOLOGY TABLES
  
  // stub methods load terminology and replace themselves with the real lookup methods on first use
  
  // pack/unpack keywords
  
  typeCodeForName(name) { // used to look up property keys
    return _loadTerminology(this).typeCodeForName(name);
  }
  
  typeNameForCode(code) { // used to unpack keyword objects
    return _loadTerminology(this).typeNameForCode(code);
  }
  
  // pack/unpack specifiers
  
  // TO DO: probably merge these
  
  propertyCodeForName(name) {
    return _loadTerminology(this).propertyCodeForName(name);
  }
  
  propertyNameForCode(code) {
    return _loadTerminology(this).propertyNameForCode(code);
  }
  
  elementsCodeForName(name) {
    return _loadTerminology(this).elementsCodeForName(name);
  }
  
  elementsNameForCode(code) {
    return _loadTerminology(this).elementsNameForCode(code);
  }
  
  // pack/unpack Apple event
  
  commandDefinitionForName(name) {
    return _loadTerminology(this).commandDefinitionForName(name);
  }
  
  commandDefinitionForCode(eventClass, eventID) {
    return _loadTerminology(this).commandDefinitionForCode(eventClass, eventID);
  }
}


/****************************************************************************************/

// TO DO: should be able to assign Proxy to _typesByName, etc, so that the Proxy replaces itself on first use

const _terminologyAccessors = { // these will be bound to AppData the first time terminology lookup is performed, replacing stub terminology lookup methods
  
  typeCodeForName: function(name) { // used to look up property keys
    // name : string
    // Result: {type:OSType,code:OSType} | undefined
    return this._typesByName[name];
  },
  
  typeNameForCode: function(code) { // used to unpack keyword objects
    // code : OSType
    // Result: {type:OSType,name:string} | undefined
    return this._typesByCode[code];
  },
  
  // pack/unpack specifiers
  
  propertyCodeForName: function(name) {
    // name : string
    // Result: OSType | undefined
    return this._propertiesByName[name];
  },
  
  propertyNameForCode: function(code) {
    // code : OSType
    // Result: string | undefined // TO DO: what if it's an ambiguous term that's used as both property and elements name, in which case it needs disambiguated
    return this._propertiesByCode[code];
  },
  
  elementsCodeForName: function(name) {
    // name : string
    // Result: OSType | undefined
    return this._elementsByName[name];
  },
  
  elementsNameForCode: function(code) {
    // code : OSType
    // Result: string | undefined
    return this._elementsByCode[code];
  },
  
  // pack/unpack Apple event
  // command definition is object of form: {name:STRING,eventClass:OSTYPE,eventID:OSTYPE,params:{NAME:CODE,...}}
  
  commandDefinitionForName: function(name) { // string -> Object/undefined; used to construct AppleEvent descriptor
    return this._commandsByName[name];
  },
  
  commandDefinitionForCode: function(eventClass, eventID) { // OSType -> Object/undefined
    for (let term of this._commandsByName) {
      if (term.eventClass === eventClass && term.eventID === eventID) { return term; }
    }
    return undefined;
  },
};


function _loadTerminology(appData) { // TO DO: need to merge this into target as it may launch process, in which case we don't want to launch it a second time if 'new instance' flag is set
  let glueTable;
  if (appData.terminologyTables === null) {
    let url;
    switch (appData.targetType) {
    case "named":
      url = aesupport.fileURLForLocalApplication(appData.targetID);
      if (!url) { throw new Error(`Application not found: ${appData.targetID}`); }
      break;
    case "at": // eppc: URL
      url = appData.targetID;
      break;
    case "ID":
      if (aesupport.isString(appData.targetID)) { // bundleID
        let appPath = objc.NSWorkspace.sharedWorkspace().absolutePathForAppBundleWithIdentifier_(
                                          appData.targetID);
        if (!appPath) { throw new Error(`Can't find ${appData.targetID}: ${error}`); }
        url = objc.NSURL.fileURLWithPath_(appPath);
      } else if (aesupport.isNumber(appData.targetID)) { // ProcessID
        let runningProcess;
        try {
          runningProcess = objc.NSRunningApplication.runningApplicationWithProcessIdentifier_(
                                        aesupport.SInt32(appData.targetID));
        } catch(e) {
          throw new Error(`app.ID(...) received bad process ID number: ${appData.targetID}`);
        }
        if (!runningProcess) { 
          throw new Error(`Can't find running application with PID ${appData.targetID}: ${error}`);
        }
        url = runningProcess.bundleURL();
      } else if (aesupport.isNSAppleEventDescriptor(appData.targetID)) { // AEAddressDesc?
          // can't send ascr/gsdf event as macOS bugs prevent a valid SDEF data being returned if app bundle doesn't contain an .sdef file (i.e. the standard «event ascrgsdf» handler should be smart enough to automatically transcode AETE/.scriptTerminology if that's what app uses, but it doesn't, e.g. TextEdit uses old-style .scriptTerminology so «event ascrgsdf» returns 'resource not found' error, making it effectively useless)
        throw new Error(`Can't automatically retrive terminology when targeting app by AEAddressDescriptor ${appData.targetID}; supply a static terminology object instead.`);
      } else {
        throw new TypeError(`app.ID(...) requires bundle ID, process ID, or address descriptor but received: ${appData.targetID}`);
      }
      break;
    case "currentApplication":
      url = objc.NSBundle.mainBundle()?.bundleURL?.(); // this may be e.g. '/usr/local/bin' when running directly in node CLI, so do not assume it is a valid .app bundle
      break;
    default:
      throw new TypeError(`Bad target type: "${appData.targetType}"`);
    }
    glueTable = url ? aegluetable.glueTableForApplication(url) : new aegluetable.GlueTable(); // kludge; see above TODO
  } else {
    glueTable = new aegluetable.GlueTable();
    try {
      glueTable.addTerminology(appData.terminologyTables);
    } catch (e) {
      throw new TypeError(`Invalid "terminologyTables" value: ${e}`);
    }
  }
  appData._typesByName      = glueTable.typesByName;
  appData._typesByCode      = glueTable.typesByCode;
  appData._propertiesByName = glueTable.propertiesByName;
  appData._propertiesByCode = glueTable.propertiesByCode;
  appData._elementsByName   = glueTable.elementsByName;
  appData._elementsByCode   = glueTable.elementsByCode;
  appData._commandsByName   = glueTable.commandsByName;
  Object.assign(appData, _terminologyAccessors);
  return appData;
}


/****************************************************************************************/
// untargeted specifiers contain a minimal AppData object that does not contain an application address or terminology,
// so can only be used in other (targeted) specifiers and commands; this enables a more elegant query-building API


class UntargetedAppData {
  
  constructor(selectortables) {
    // used by formatter
    this.targetType = null; // named/ID/at/currentApplication
    this.targetID = null;
    Object.assign(this, selectortables);
  }
  
  // used by formatter when untargeted specifiers render themselves
  typeCodeForName()          { return undefined; }
  typeNameForCode()          { return undefined; }
  
  // TO DO: merge ATTRIBUTECodeForName into one?
  propertyCodeForName()      { return undefined; }
  elementsCodeForName()      { return undefined; }
  commandDefinitionForName() { return undefined; }
  
  propertyNameForCode()      { return undefined; }
  elementsNameForCode()      { return undefined; }
  commandDefinitionForCode() { return undefined; }
  
}


const untargetedAppRoot = aeselectors.newRootSpecifier(new UntargetedAppData(aeselectors.untargetedAppRootTables));
const untargetedConRoot = aeselectors.newRootSpecifier(new UntargetedAppData(aeselectors.untargetedConRootTables));
const untargetedItsRoot = aeselectors.newRootSpecifier(new UntargetedAppData(aeselectors.untargetedItsRootTables));


/****************************************************************************************/


module.exports.AppData = AppData;
module.exports.untargetedAppRoot = untargetedAppRoot; // app
module.exports.untargetedConRoot = untargetedConRoot; // con
module.exports.untargetedItsRoot = untargetedItsRoot; // its


