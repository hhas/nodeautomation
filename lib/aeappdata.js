
'use strict';

// AppData

const os = require('os');
const util = require('util');

const ffi = require('ffi-napi');
const ref = require('ref-napi');

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
});

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

const AEBUFFER_SIZE = 1024; // TO DO: Buffer may allocate new buffers from pool of previously allocated buffers, which will reduce overheads; however, we might want to grow this initial size if AEDescriptorBuffer is growing often as even if Buffers are reused there is still the overhead of copying existing data from the smaller to the larger buffer; e.g. by having _grow set the initial size to e.g. median of last 10 allocs (a simpler algorithm might be number of grows divided by number of instantiations, and adjust size up until that fraction falls below a fixed limit)


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
		if (!(buffer instanceof Buffer)) { throw new TypeError(`writeBuffer expected Buffer, got ${typeof buffer}: ${util.inspect(buffer)}`); }
		const bytesRequired = buffer.length;
		if (this.offset + bytesRequired > this.rawBuffer.length) { this._grow(bytesRequired); }
		buffer.copy(this.rawBuffer, this.offset);
		this.offset += bytesRequired;
		this.align();
		return bytesRequired;
	}
	
	toDescriptor() {
		const aedescPtr = ref.alloc('pointer');
		// note: the rawBuffer may be larger than the flattened AEDesc data (the extra bytes are not an issue for AEUnflattenDesc as serialized AEDescs already include their own size); for now we use Buffer.alloc, not Buffer.allocUnsafe, so those extra bytes will always be initialized to 00
		const err = aem.AEUnflattenDesc(this.rawBuffer, aedescPtr);
		if (err !== 0) {
			throw new Error(`Error ${err}: failed to unflatten buffer:\n<${this.rawBuffer.subarray(0, this.offset)}>`);
		}
		const descriptor = objc.NSAppleEventDescriptor.alloc().initWithAEDescNoCopy_(aedescPtr);
		descriptor[objc.__internal__.keyObjCObject].__aedescPtr = aedescPtr; // ensure GC doesn't collect AEDesc early
		return descriptor;
	}
	
	[Symbol.toPrimitive](hint) {
		return hint === 'number' ? Number.NaN : this[util.inspect.custom]();
	}
	
	[util.inspect.custom]() {
		return `<${this.rawBuffer.subarray(0, this.offset)}>`;
	}
}


/****************************************************************************************/
// application launch/relaunch options

// deprecated in macOS12
// -[NSWorkspace launchApplicationAtURL:options:configuration:error:]

const kLaunchOptions = {
	launchWithErrorPresentation:	0x00000040,
	launchInhibitingBackgroundOnly: 0x00000080,
	launchWithoutAddingToRecents:   0x00000100,
	launchWithoutActivation:		0x00000200,
	launchNewInstance:			  0x00080000,
	launchAndHide:				  0x00100000,
	launchAndHideOthers:			0x00200000,
}; // launchAndPrint and launchAsync are omitted as they're not appropriate here

const kDefaultLaunchOptions = kLaunchOptions.launchWithoutActivation;

function readLaunchOptions(value) { // [Keyword,...] -> UInt32
	var launch = 0, relaunch = 0;
	if (!Array.isArray(value)) { value = [value]; }
	for (var item in value) {
		if (!(item instanceof aesupport.Keyword)) {
			throw new TypeError(
					`Bad "launchOptions" value (not an array of keywords): ${aeformatter.formatValue(value)}`);
		}
		const flag = kLaunchOptions[item.name];
		if (flag === undefined) {
			throw new TypeError(
					`Bad "launchOptions" value (unknown "${item}" keyword): ${aeformatter.formatValue(value)}`);
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
const kLimitedRelaunchEvents = [kae.kCoreEventClass + '/' + kae.kAEOpenApplication,  // `someApp.run()`
								kae.kASAppleScriptSuite + '/' + kae.kASLaunchEvent]; // `someApp.launch()`


/****************************************************************************************/
// -[NSAppleEventDescriptor sendEventWithOptions:timeout:] flags

const kSendOptions = {
	ignoreReply:	0x00000001, /* sender doesn't want a reply to event */
	queueReply:	 0x00000002, /* sender wants a reply but won't wait */
	waitReply:	  0x00000003, /* sender wants a reply and will wait */
	neverInteract:  0x00000010, /* server should not interact with user */
	canInteract:	0x00000020, /* server may try to interact with user */
	alwaysInteract: 0x00000030, /* server should always interact with user where appropriate */
	canSwitchLayer: 0x00000040, /* interaction may switch layer */
	dontRecord:	 0x00001000, /* don't record this event */
	dontExecute:	0x00002000, /* don't send the event for recording */
	dontAnnotate:   0x00010000, /* if set, don't automatically add any sandbox or other annotations to the event */
	defaultOptions: 0x00000003 | 0x00000020, /* waitForReply | canInteract */
};

function readSendOptions(value) { // [Keyword,...] -> UInt32
	var sendFlags = 0;
	if (!Array.isArray(value)) { value = [value]; }
	for (var item of value) {
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


/****************************************************************************************/
// considering/ignoring options (where supported by apps)

const kIgnoringOptions = { // this is supremely nasty; a right mess x2
	case:           {enumerator: kae.kAECase,           ignore: 0x00010000, consider: 0x00000001},
	diacritic:      {enumerator: kae.kAEDiacritic,      ignore: 0x00020000, consider: 0x00000002},
	whiteSpace:     {enumerator: kae.kAEWhiteSpace,     ignore: 0x00040000, consider: 0x00000004},
	hyphens:        {enumerator: kae.kAEHyphens,        ignore: 0x00080000, consider: 0x00000008},
	expansion:      {enumerator: kae.kAEExpansion,      ignore: 0x00100000, consider: 0x00000010},
	punctuation:    {enumerator: kae.kAEPunctuation,    ignore: 0x00200000, consider: 0x00000020},
	numericStrings: {enumerator: kae.kASNumericStrings, ignore: 0x00800000, consider: 0x00000080},
}; 

const _considerAll = (function() { var result = 0;
								   for (var k in kIgnoringOptions) { result |= kIgnoringOptions[k].consider; }
								   return result; })();


function readIgnoringOptions(value) { // [Keyword,...] -> [AEListDesc,AEDesc]

// TO DO: FIX: either return NSAppleEventDescriptors or wait until sendAppleEvent does its own AE serialization

	var considerIgnoreFlags = _considerAll; // all considering flags; these will be unset as ignoring flags are set
	const ignoresList = [];
	if (!(value instanceof Array)) { value = [value]; }
	for (var item of value) {
		if (!(item instanceof aesupport.Keyword)) {
			throw new aeerrors.ParameterError(value, 'Bad "ignoring" attribute');
		}
		const optionDef = kIgnoringOptions[item.name];
		if (optionDef === undefined) {
			throw new TypeError(`Bad "ignoring" attribute (unknown item: ${item}): ${aeformatter.formatValue(value)}`);
		}
		considerIgnoreFlags |= optionDef.ignore;
		considerIgnoreFlags &= ~optionDef.consider;
		ignoresList.push(optionDef.enumerator);
	}
	return {ignoresList, considerIgnoreFlags};	// {[OSType], UInt32}
}

const kDefaultIgnoringDescriptors = readIgnoringOptions([new aesupport.Keyword('case')]);


/****************************************************************************************/
// other constants


// bug workaround: NSAppleEventDescriptor.sendEvent(options:timeout:) method's support for kAEDefaultTimeout=-1 and kNoTimeOut=-2 flags is buggy <rdar://21477694>, so for now the default timeout is hardcoded here as 120sec (same as in AS)
// const kAEDefaultTimeout = -1
// const kNoTimeOut = -2
const kDefaultTimeout = 120 


const kMissingValueDescriptor = objc.NSAppleEventDescriptor.descriptorWithTypeCode_(kae.cMissingValue);

// check when unpacking
const kComparisonOperatorCodes = new Set([kae.kAELessThan, kae.kAELessThanEquals, kae.kAEEquals, kae.kAEGreaterThan, 
										kae.kAEGreaterThanEquals, kae.kAEBeginsWith, kae.kAEEndsWith, kae.kAEContains]);
const kLogicalOperatorCodes = new Set([kae.kAEAND, kae.kAEOR, kae.kAENOT]);

const kAppRootDesc = objc.NSAppleEventDescriptor.nullDescriptor();


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
	for (var i = 0; i < foundProcesses.count(); i++) {
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
	var runningProcess = processForLocalApplication(url);
	if (!runningProcess) {
		var error = new objc.Ref();
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
	var error = new objc.Ref();
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
			const send = this._sendAppleEvent;
			this._sendAppleEvent = function (event, sendOptions, timeoutInSeconds) {
				console.log('AE SEND: ', event); // outgoing Apple event
				const [reply, error] = send(event, sendOptions, timeoutInSeconds);
				console.log('AE REPLY:', reply); // application result/error
				console.log('AE ERROR:', error); // Apple Event Manager error
				return [reply, error];
			};
		}
		switch (typeof options.terminology) {
		case 'undefined':
		case 'null':
			this.terminologyTables = null;
			break;
		case 'string': // file path // TO DO: FIX: could also be String object
			try {
				this.terminologyTables = JSON.parse(require('fs').readFileSync(options.terminology, 'utf8'));
				if (typeof this.terminologyTables !== 'object') {
					throw new TypeError(`JSON file doesn't contain a terminology object: ${this.terminologyTables}`);
				}
			} catch (e) {
				throw new aeerrors.TerminologyError(
					`Can't read terminology from file ${aeformatter.formatValue(options.terminology)}: ${e}`);
			}
			break;
		case 'object':
			this.terminologyTables = options.terminology;
			break;
		default:
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
			var desc;
			switch (this.targetType) {
			case "named":
				if (!aesupport.isString(this.targetID)) {
					throw new TypeError(`app.named(...) requires a name/path string but received ${typeof this.targetID}: ${util.inspect(this.targetID)}`);
				}
				var url = aesupport.fileURLForLocalApplication(this.targetID);
				if (!url) {
					throw new aeerrors.ConnectionError(`Application not found: ${util.inspect(this.targetID)}`, -10814); // TO DO: not sure about this error number
				}
				desc = processDescriptorForLocalApplication(url, this.workspaceLaunchOptions);
				break;
			case "at": // eppc: URL
				if (!aesupport.isString(this.targetID)) {
					throw new TypeError(`app.at(...) requires an "eppc:" URL string but received ${typeof this.targetID}: ${util.inspect(this.targetID)}`);
				}
				var url = objc.NSURL.URLWithString_(this.targetID);
				if (!url || objc.js(url.scheme()).toLowerCase() !== 'eppc') {
					throw new TypeError(`app.at(...) requires an "eppc:" URL but received: ${util.inspect(this.targetID)}`);
				}
				return objc.NSAppleEventDescriptor.descriptorWithApplicationURL_(url);
			case "ID":
				switch (typeof this.targetID) {
				case 'string': // bundleIdentifier
					throw new Error('TO DO: na.app.ID(bundleID)');
					//
					/*
					var error = new objc.Ref();
					var runningProcess = objc.NSWorkspace.sharedWorkspace()
							.launchApplicationWithBundleIdentifier_options_configuration_error_(
																	this.targetID,
														  			this.workspaceLaunchOptions,
														  			objc.NSDictionary.dictionary(),
														  			error);
					if (!runningProcess) {
						const [message, number] = infoForNSError(error.deref());
						throw new aeerrors.ConnectionError(`Can't launch application at ${util.inspect(this.targetID)}: ${message}`, number);
					}
					desc = objc.NSAppleEventDescriptor.descriptorWithProcessIdentifier_(
															runningProcess.processIdentifier());
					*/
					break;
				case 'number': // ProcessID
					try {
						desc = objc.NSAppleEventDescriptor.descriptorWithProcessIdentifier_( 
															aesupport.SInt32(this.targetID));
					} catch(e) { // catch out-of-bounds errors from SInt32()
						throw new TypeError(`app.ID(...) received bad process ID number: ${this.targetID}`);
					}
					break;
				case 'function': // NSAppleEventDescriptor?
					if (aesupport.isDescriptor(this.targetID)) { return this.targetID; } // caution: it is user's responsibility to ensure supplied descriptor is a valid AEAddressDesc
				default: // else fallthru
					throw new TypeError(`app.ID(...) requires bundle ID, process ID, or address descriptor but received: ${this.targetID}`);
				}
				break;
			case "currentApplication":
				desc = objc.NSAppleEventDescriptor.currentProcessDescriptor();
				break;
			default:
				throw new TypeError(`Bad target type: "${this.targetType}"`);
			}
			this._targetDescriptor = desc;
			return desc;
		}
		return this._targetDescriptor;
	}
	
	isRunning() {
		switch (this.targetType) {
		case 'named': // application's name (.app suffix is optional) or full path
			var url = aesupport.fileURLForLocalApplication(this.targetID);
			return Boolean(url && processForLocalApplication(url));
		case 'at': // "eppc" URL
			var url = objc.NSURL.URLWithString_(url);
			return isRunningWithAddressDescriptor(objc.NSAppleEventDescriptor.descriptorWithApplicationURL_(url));
		case 'ID':
			switch (typeof this.targetID) {
			case 'string': // bundleID
				return objc.NSRunningApplication.runningApplicationsWithBundleIdentifier_( 
																			   this.targetID).count() > 0;
			case 'number': // PID
				return Boolean(objc.NSRunningApplication.runningApplicationWithProcessIdentifier_(this.targetID));
			default: // AEAddressDesc
				return isRunningWithAddressDescriptor(this.targetID);
			}
		}
		return true; // currentApplication
	}
	
	
	isRelaunchable() { // only local apps targeted by name/path/bundleID can be automatically relaunched
		return (this.targetType === 'named' || (this.targetType === 'ID' && aesupport.isString(this.targetID)));
	}
	
	
	isRunningWithAddressDescriptor(desc) {
		return !kProcessNotFoundErrorNumbers.includes(this._sendLaunchEvent(desc));
	}

	//
	
	_sendAppleEvent(event, sendOptions, timeoutInSeconds) { // used by sendAppleEvent()
		// returns [null, NSError] on AEM errors (-1712 'event timed out', -600 'process not found', etc)
		// (note: application errors are reported via the reply event, not by AEM)
		var error = new objc.Ref();
		var replyEvent = event.sendEventWithOptions_timeout_error_(sendOptions, timeoutInSeconds, error);
		return [replyEvent, replyEvent ? null : error.deref()]; // TO DO: is there reliable way to check if NSError** is nilptr?
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
		const [replyEvent, error] = this._sendAppleEvent(event, kSendOptions.waitReply, 30);
		if (!replyEvent) { return error.code(); }
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
				var url = aesupport.fileURLForLocalApplication(this.targetID);
				if (!url) {
					throw new aeerrors.ConnectionError(`Can't launch application named ${util.inspect(this.targetID)}: Application not found.`, -10814);
				}
				launchApplicationAtURL(url); // throws on failure
				return;
			case 'at':
				// TO DO: NA doesn't do file URLs and eppc URLs can't launch; all we can do is send it RAE (but need to check if that's what AS does)
				//launchApplicationAtURL(objc.NSURL.URLWithString_(this.targetID));
				throw new Error('TBC');
				return;
			case 'ID':
				if (!aesupport.isString(this.targetID)) {
					throw new aeerrors.ConnectionError(`Can't launch application with process ID ${util.inspect(this.targetID)}: Application not found.`, number);
				}
				var url = NSWorkspace.sharedWorkspace().urlForApplicationWithBundleIdentifier_(this.targetID);
				if (!url) {
					throw new aeerrors.ConnectionError(`Can't launch application with bundle ID ${util.inspect(this.targetID)}: Application not found.`, -10814);

				}
				launchApplicationAtURL(url);
				return;
			} // fall through on failure
			throw new aeerrors.ConnectionError("Can't launch application.", -10814); // TO DO: what error message/number to use here?
		}
	}
	
	
	/************************************************************************************/
	// AE DISPATCH
	
	sendAppleEvent(commandDef, parentSpecifierRecord, parametersObject) {
		var replyEvent = null, nsError = null;
		try {
			if (typeof parametersObject !== 'object') {
				throw new TypeError(
					`Bad command argument: expected a parameters object but received ${typeof parametersObject}.`);
			}
			var directParameter = aesupport.kNoParameter;
			var subjectAttribute = kAppRootDesc; // default subject is typeNull descriptor (`app`)
			var timeoutInSeconds = kDefaultTimeout;
			var sendOptions = kDefaultSendOptions, ignoringDescs = kDefaultIgnoringDescriptors;
			
			// TO DO: migrate to AEDescriptorBuffer, eliminating NSAppleEventDescriptor dependency
			
			var appleEvent = objc.NSAppleEventDescriptor
							.appleEventWithEventClass_eventID_targetDescriptor_returnID_transactionID_(
																commandDef.eventClass, 
																commandDef.eventID, 
																this.target(), 
																kae.kAutoGenerateReturnID, 
																kae.kAnyTransactionID);
			for (let [key, value] of Object.entries(parametersObject)) {
 			   try {
					const paramCode = commandDef.params[key];
					if (paramCode !== undefined) {
						appleEvent.setParamDescriptor_forKeyword_(this.pack(value), paramCode);
					} else {
						switch(key) {
						case "_":
							directParameter = this.pack(value);
							break;
						case "asType": // must be keyword
							if (!(value instanceof aesupport.Keyword)) {
								throw new aeerrors.ParameterError(value, 'Bad asType attribute (not a keyword)');
							}
							appleEvent.setParamDescriptor_forKeyword_(this.pack(value), kae.keyAERequestedType);
							break;
						case "sendOptions": // all send flags; [array of] keywords, e.g. [k.ignoreReply,...]
							sendOptions = readSendOptions(value);
							break;
						case "withTimeout": 
							// caution: -[NSAppleEventDescriptor sendEventWithOptions:timeout:] is buggy: it multiplies timeout in seconds by 60 to get timeout in ticks, but should only do this for non-negative values (negative numbers are flags: 'kAEDefaultTimeout=-1' and 'kNoTimeOut=-2'); therefore we use `null` = default timeout and `0` = no timeout
							if (value !== null) { // users can pass `null` to indicate default timeout (120sec)
								try {
									timeoutInSeconds = aesupport.SInt32(value);
									if (timeoutInSeconds <= 0) { // 'no timeout'
										timeoutInSeconds = -2; // fortunately AEM treats any value <= -2 as 'no timeout'
									}
								} catch(e) {
									throw new aeerrors.ParameterError(value, 
											"Bad timeout attribute (not an integer or null)");
								}
							}
							break;
						case "ignoring": // text attributes to consider/ignore (if supported by app); [array of] keywords
							ignoringDescs = readIgnoringOptions(value);
							break;
						default: // if four-char code (e.g. '#docu', '0x646f6375') pack as param, else throw 'unknown'
							var rawParamCode;
							try {
								rawParamCode = aesupport.parseFourCharCode(key); 
							} catch(e) {
								throw new aeerrors.ParameterError(value, `Unknown parameter/attribute: "${key}"`);
							}
							appleEvent.setParamDescriptor_forKeyword_(this.pack(value), rawParamCode);
						}
					}
				} catch (e) {
 					if (!(e instanceof aeerrors.ParameterError)) { // PackError/bugs
 				   		let msg = `Bad "${key}" parameter`;
 						if (e instanceof aeerrors.PackError) { msg += `: can't pack ${typeof value} as descriptor`; }
  						e = new aeerrors.ParameterError(value, msg, e);
 				   }
 				   throw e;
				}
			}
			// special-case where command os called on a specifier, e.g. SPECIFIER.COMMAND() -> APP.COMMAND(_:SPECIFIER)
			if (parentSpecifierRecord.form !== aesupport.kSpecifierRoot) {
			
			
				const aebuffer = new AEDescriptorBuffer();
				parentSpecifierRecord.pack(aebuffer, this, parentSpecifierRecord);
				const parentSpecifierDesc = aebuffer.toDescriptor();
				
				
				if (commandDef.eventClass === kae.kAECoreSuite && commandDef.eventID === kae.kAECreateElement) {
					// special-case shortcut for `make` (this uses parentSpecifier as `at` instead of direct param)
					if (!appleEvent.paramDescriptorForKeyword_(kae.keyAEInsertHere)) {
						appleEvent.setParamDescriptor_forKeyword_(parentSpecifierDesc, kae.keyAEInsertHere);
					} else {
						subjectAttribute = parentSpecifierDesc;
					}
				} else {
					if (directParameter === aesupport.kNoParameter) {
						directParameter = parentSpecifierDesc;
					} else {
						subjectAttribute = parentSpecifierDesc;
					}
				}
			}
			if (directParameter !== aesupport.kNoParameter) {
				appleEvent.setParamDescriptor_forKeyword_(directParameter, kae.keyDirectObject);
			}
			
			
			// TO DO: pack these directly into attributes
//			const {ignoresList, considerIgnoreFlags} = ignoringDescs;
//			appleEvent.setAttributeDescriptor_forKeyword_(ignoresList, kae.enumConsiderations);
//			appleEvent.setAttributeDescriptor_forKeyword_(considerIgnoreFlags, kae.enumConsidsAndIgnores);
			
			
			
			appleEvent.setAttributeDescriptor_forKeyword_(subjectAttribute, kae.keySubjectAttr);
			// send the AppleEvent
			[replyEvent, nsError] = this._sendAppleEvent(appleEvent, sendOptions, timeoutInSeconds);
			// console.log('SENT EVENT:',appleEvent, '\nREPLY EVENT:',replyEvent, '\nAEM ERROR:',nsError); // DEBUG
			// check for errors raised by Apple Event Manager (e.g. timeout, process not found)
			if (!replyEvent) {
				if (kRelaunchableErrorCodes.includes(nsError.code())
					&& this.isRelaunchable() 
					&& (this.relaunchMode === kRelaunchModes.always
						|| (this.relaunchMode === kRelaunchModes.limited 
							&& kLimitedRelaunchEvents.includes(commandDef.eventClass+'/'+commandDef.eventID)))) {
					// event failed as target process has quit since previous event; recreate AppleEvent with new a address descriptor and resend
					this._targetDescriptor = null; // discard the old AEAddressDesc
					const oldAppleEvent = appleEvent;
					appleEvent = objc.NSAppleEventDescriptor
							.appleEventWithEventClass_eventID_targetDescriptor_returnID_transactionID_(
																			commandDef.eventClass, 
																			commandDef.eventID, 
																			this.target(), 
																			kae.kAutoGenerateReturnID, 
																			kae.kAnyTransactionID);
					for (var i = 1; i <= oldAppleEvent.numberOfItems; i++) {
						appleEvent.setParamDescriptor_forKeyword_(oldAppleEvent.descriptorAtIndex_(i), 
								   								  oldAppleEvent.keywordForDescriptorAtIndex_(i));
					}
					for (var key of [kae.keySubjectAttr, kae.enumConsiderations, kae.enumConsidsAndIgnores]) {
						appleEvent.setAttributeDescriptor_forKeyword_(
																oldAppleEvent.attributeDescriptorForKeyword_(key),
																key);
					}
					[replyEvent, nsError] = this._sendAppleEvent(appleEvent, sendOptions, timeoutInSeconds);
				}
				if (!replyEvent) { throw new aeerrors.AppleEventManagerError(nsError.code()); }
			}
			return this.unpackReplyEvent(replyEvent, sendOptions);
		} catch (parentError) { // rethrow all errors as CommandError
			throw new aeerrors.CommandError(this, commandDef, parentSpecifierRecord, parametersObject, parentError);
		}
	}
	
	
	unpackReplyEvent(replyEvent, sendOptions) { // unpack application error/result, if any
		// To return raw reply events, construct `app` object as normal then patch its AppData as follows:
		//
		//   const someApp = app(...);
		//   someApp[aesupport.__appData].unpackReplyEvent = function(replyEvent,sendOptions){return replyEvent;};
		//   var replyEvent = someApp.someCommand(...); // -> <NSAppleEventDescriptor: 'aevt'\'ansr'{...}>
		//
		if (sendOptions & kSendOptions.waitReply) {
			const errorNumberDesc = replyEvent.paramDescriptorForKeyword_(kae.keyErrorNumber);
			if (errorNumberDesc && errorNumberDesc.int32Value() !== 0) { // an application error occurred
				throw new aeerrors.ApplicationError(this, replyEvent);
			} else {
				const resultDesc = replyEvent.paramDescriptorForKeyword_(kae.keyDirectObject);
				if (resultDesc) { return this.unpack(resultDesc); }
			} // no return value or error, so fall through
		} else if (sendOptions & kSendOptions.queueReply) { // return the returnID attribute that the reply event will use to identify itself when it arrives in host process's event queue (note: this design may change if implementing async callbacks)
			const returnIDDesc = event.attributeDescriptorForKeyword_(kae.keyReturnIDAttr);
			if (!returnIDDesc) { // sanity check
				throw new aeerrors.ParameterError(null, "Can't get keyReturnIDAttr from reply event");
			}
			return this.unpack(returnIDDesc);
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
			// 									OR little-endian UTF16 with required byte-order-mark
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
			
			} else if (value.constructor.name === 'Object') { // record
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
						throw new TypeError(`_writeDescriptor expected string key, got ${typeof key}: ${value}`);
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
					aeBuffer.writeUInt32BE(kae.keyASUserRecordField);
					this._writeDescriptor(aeBuffer, userProperties);
					count++;
				}
				aeBuffer.rawBuffer.writeUInt32BE(aeBuffer.offset - dataStartOffset, dataSizeOffset); // write data size
				aeBuffer.rawBuffer.writeUInt32BE(count, countOffset); // write count of items in record
			
			
			} else if (objc.isInstance(value)) {
				throw new Error(`TO DO: pack ${value}`);
				// TO DO: pack ObjCInstance (particularly NSAppleEventDescriptor)
				
			} else {
				throw new TypeError(`_writeDescriptor expected simple object, got ${value.constructor.name}: ${String(value)}`);
			}
	
		} else {
			throw new TypeError(`_writeDescriptor can't pack unsupported ${typeof value}: ${String(value)}`);
		}
	}
	
	pack(value) {
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
			return aebuffer.toDescriptor();
		} catch (e) {
			throw new aeerrors.PackError(value, e);
		}
	}
	
	
	/************************************************************************************/
	// UNPACK
	
	_unpackFourCharCode(rawBuffer) {
		const type = rawBuffer.readUInt32BE(rawBuffer.aeoffset);
		rawBuffer.aeoffset += 4;
		const size = rawBuffer.readUInt32BE(rawBuffer.aeoffset);
		rawBuffer.aeoffset += 4;
		if (type !== kae.typeType && type !== kae.typeEnumerated || size  !== 4) {
			throw new Error(`not a valid type/enum: ${aesupport.formatFourCharLiteral(type)}`);
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
				throw new Error(`expected 4 properties, got ${count}`);
			}
			rawBuffer.aeoffset += 8; // step over count and 4-byte padding
			for (var i = 0; i < count; i++) {
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
					throw new Error(`unknown property: '${aesupport.formatFourCharCode(code)}'`);
				}
			}
			if (want === undefined || form === undefined || seld === undefined || from === undefined) {
				throw new Error(`missing property: {want:${want}, form:${form}, seld:${seld}, from:${util.inspect(from)}}`);
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
					throw new Error(`invalid range specifier: ${String(seld)}`);
				}
				value = new aeselectors.Range(seld[kae.keyAERangeStart], seld[kae.keyAERangeStop], want);
				selectors = this.multipleElementsSpecifierAttributes;
				break;
			case kae.formTest:
				// this check is arguably redundant if we assume descriptors are always well-formed
				if (!aeselectors.isSpecifier(seld)) { // minimal check (this doesn't confirm it's its-based)
					throw new Error(`invalid test specifier: ${String(seld)}`);
				}
				selectors = this.multipleElementsSpecifierAttributes;
				break;
			default:
				throw new Error(`unknown form: ${aesupport.formatFourCharLiteral(form)}`);
			}
			if (rawBuffer.aeoffset !== expectedEndOffset) {
				throw new Error(`expected ${expectedEndOffset} bytes, read ${rawBuffer.aeoffset}`);
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
			throw new Error(`Can't unpack object specifier (malformed descriptor): ${e}`);
		}
	}
	
	
	_unpackAERecord(rawBuffer, expectedEndOffset, fullyUnpack = false, hasHeader = false, rawKeys = false) {
		// aeoffset should be positioned immediately after descriptorType and size fields
		// note: this only unpacks the AERecord's properties; it does not add a 'class' property containing the actual descriptorType to returned object (caller can add a 'class' property to the returned object if needed)
		// rawBuffer.aeoffset should be positioned at end of record on return, or unchanged if an error occurred
	 	const dataStartOffset = rawBuffer.aeoffset; // store current offset to rollback if unpacking as AERecord fails
		const value = Object.create(null); // AERecord is analogous to a C struct
	 	try {
			if (hasHeader) { // flattened 'reco' has extra header
				rawBuffer.aeoffset += 16; // TO DO: should we validate any of these 4-byte fields?
			}
			const count = rawBuffer.readUInt32BE(rawBuffer.aeoffset);
			rawBuffer.aeoffset += 8; // step over count and 4-byte padding
			for (var i = 0; i < count; i++) {
				const code = rawBuffer.readUInt32BE(rawBuffer.aeoffset);
				rawBuffer.aeoffset += 4; // step over key
				if (code === kae.keyASUserRecordField) {
					const items = this._readDescriptor(rawBuffer);
					if (!(items instanceof Array) || items.length % 2 !== 0) {
						throw new Error(`bad value for keyASUserRecordField`);
					}
					for (let i = 0; i < items.length; i += 2) {
						const key = this._readDescriptor(rawBuffer);
						if (!aesupport.isString(key)) {
							throw new Error(`bad value for keyASUserRecordField`);
						}
						value[`$${key}`] = this._readDescriptor(rawBuffer, fullyUnpack);
					}
				} else {
					const key = rawKeys ? code : this.typeNameForCode(code).name;
					value[key] = this._readDescriptor(rawBuffer, fullyUnpack);
				}
			}
			if (rawBuffer.aeoffset !== expectedEndOffset) {
				throw new Error(`expected ${expectedEndOffset} bytes, read ${rawBuffer.aeoffset}`);
			}
		} catch (e) {
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
		throw new TypeError(`Can't unpack comparison test (malformed descriptor): ${util.inspect(desc)}`);
	}

	_unpackLogicalDescriptor(rawBuffer, expectedEndOffset, fullyUnpack) {
		const descriptorStartOffset = rawBuffer.aeoffset - 8;
		const record = this._unpackAERecord(rawBuffer, expectedEndOffset, fullyUnpack, false, true);
		const operator = record[kae.keyAELogicalOperator];
		const operands = record[kae.keyAEObject];
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
		throw new TypeError(`Can't unpack logical test (malformed descriptor): ${desc}`);
	}

	//
	
	_readDescriptor(rawBuffer, fullyUnpack = false, hasHeader = false) {
		// important: rawBuffer must have an `aeoffset` property attached containing the offset from which to read it
		if (hasHeader) {
			const header = rawBuffer.readUInt32BE();
			if (header !== 0x646c6532) {
				throw new Error(`_readDescriptor expected flattened AEDesc (#dle2), got: ${aesupport.formatFourCharLiteral(header)}`);
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
			//								  little-endian 16 bit unicode with required byte-order-mark
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
			if (hasHeader) { // flattened 'list' has extra header
				rawBuffer.aeoffset += 16; // TO DO: should we validate any of these 4-byte fields?
			}
			value = Array(rawBuffer.readUInt32BE(rawBuffer.aeoffset)); // count
			rawBuffer.aeoffset += 8; // step over count and 4-byte padding
			for (var i = 0; i < value.length; i++) {
				value[i] = this._readDescriptor(rawBuffer);
			}
			break;
		
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
		case kae.keyAELogicalOperator:
			value = this._unpackLogicalDescriptor(rawBuffer, expectedEndOffset, fullyUnpack);
			break;

		// less commonly used AEDesc types
		
		case kae.typeQDPoint: // top,left -> [left,top]
			value = [rawBuffer.readInt16BE(rawBuffer.aeoffset+2), rawBuffer.readInt16BE(rawBuffer.aeoffset)];
			aeBuffer.aeoffset += 4;
			break;
		case kae.typeQDRectangle: // top,left,bottom,right -> [left,top,right,bottom]
			value = [rawBuffer.readInt16BE(rawBuffer.aeoffset+2), rawBuffer.readInt16BE(rawBuffer.aeoffset),
					 rawBuffer.readInt16BE(rawBuffer.aeoffset+6), rawBuffer.readInt16BE(rawBuffer.aeoffset+4)];
			aeBuffer.aeoffset += 8;
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
			const urlDesc = aeBuffer.toDescriptor()?.coerceToDescriptorType_(kae.typeFileURL);
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
				value.class = new aesupport.Keyword(this.typeNameForCode(descriptorType).name);
			} catch (e) { // unknown descriptorType
				//console.log(`TO DO: unpack descriptor of type ${aesupport.formatFourCharLiteral(descriptorType)}`);
				const buffer = rawBuffer.subarray(rawBuffer.aeoffset - 8, rawBuffer.aeoffset + size);
				value = new aesupport.AEOpaqueDescriptor(buffer);
				if (size % 2 !== 0) { // align on even byte
					size++;
					expectedEndOffset++;
				}
				rawBuffer.aeoffset += size;
			}
		}
		if (expectedEndOffset % 2 !== 0) {
			throw new Error(`BUG: _readDescriptor failed to align on an even byte: ${expectedEndOffset}`);
		}
		if (expectedEndOffset !== rawBuffer.aeoffset) {
			throw new Error(`_readDescriptor expected ${aesupport.formatFourCharLiteral(descriptorType)} descriptor to end on byte ${expectedEndOffset} but ended on ${rawBuffer.aeoffset}`);
		}
		return value;
	}
	
	
	unpack(descriptor, fullyUnpack = false) {
		// descriptor : NSAppleEventDescriptor
		// fullyUnpack : boolean
		// Result: anything
		const aedescRef = descriptor.aeDesc();
		// TO DO: AESizeOfFlattenedDesc segfaults if we pass the Ref object directly; how to make Ref compatible with ref-napi's 'pointer'?
		const aedescPtr = aedescRef.value.ref(); // get a pointer to the AEDesc struct
		const size = aem.AESizeOfFlattenedDesc(aedescPtr);
		const rawBuffer = new Buffer.alloc(size);
		const writtenSize = ref.alloc(ref.types.long, 3);
		const err = aem.AEFlattenDesc(aedescPtr, rawBuffer, size, writtenSize);
		if (err !== 0) { // this shouldn't happen unless the descriptor is corrupted
			throw new Error(`Error ${err}: AppData.unpack couldn't flatten malformed descriptor for: ${String(descriptor)}`);
		}
		rawBuffer.aeoffset = 0;
		try {
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
		for (var term of this._commandsByName) {
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
			switch (typeof appData.targetID) {
			case 'string': // bundleIdentifier
			{
				let appPath = objc.NSWorkspace.sharedWorkspace().absolutePathForAppBundleWithIdentifier_(
																					appData.targetID);
				if (!appPath) { throw new Error(`Can't find ${appData.targetID}: ${error}`); }
				url = objc.NSURL.fileURLWithPath_(appPath);
				break;
			}
			case 'number': // ProcessID
			{
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
				break;
			}
			case 'function': // NSAppleEventDescriptor?
				if (aesupport.isDescriptor(appData.targetID)) {
					// caution: problem here is that we can't send ascr/gsdf event as macOS bugs prevent a valid SDEF data being returned if app bundle doesn't contain an .sdef file (i.e. the standard «event ascrgsdf» handler should be smart enough to automatically transcode AETE/.scriptTerminology if that's what app uses, but it doesn't, e.g. TextEdit uses old-style .scriptTerminology so «event ascrgsdf» returns 'resource not found' error, making it effectively useless)
					throw new Error(`Can't automatically retrive terminology when targeting app by AEAddressDescriptor ${appData.targetID}; supply a static terminology object instead.`);
				} // caution: it is user's responsibility to ensure supplied descriptor is a valid AEAddressDesc
			default: // else fallthru
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


module.exports = {
	AppData, 
	untargetedAppRoot, // app
	untargetedConRoot, // con
	untargetedItsRoot, // its
};


