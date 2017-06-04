# Type conversions

[TO DO: reorganize]

## The `k` ("keyword") namespace

For your convenience, NodeAutomation treats standard Apple event types and application-specific classes and enumerators as attributes of the top-level `k` ("keywords") object. Think of `k` as an infinitely large namespace that contains every possible name you could use. Examples:

    // AEM-defined data types:
    k.boolean
    k.UnicodeText
    k.list

    // Application-defined class names:
    k.document
    k.window
    k.disk

    // Application-defined enumerators:
    k.yes
    k.no
    k.ask


Occasionally an application defines a type or enumerator without providing it with a corresponding name name. In these cases, the value will be represented as a raw AE code, e.g. `k['#ab12']`.

To determine if a variable contains a keyword object:
    
    var someVariable = k.document;
    k.isFile(someVariable);
    //--> true

[TO DO: Keyword.compare(); what else?]

## Common AE types

[TO DO: need to provide table of AE type -> keyword name -> JavaScript type mappings, e.g. `typeInteger` -> `k.integer` -> JS `number`]


## Type mapping notes

While AE-JS type conversions generally work quite seamlessly, it is sometimes useful to know some of the details involved, particularly when troubleshooting code that deals with older or buggy applications.

### Undefined

NodeAutomation rejects `undefined` as invalid.


### Null

For convenience, NodeAutomation maps JS's `null` value to the `missing value` constant. This allows you to check for missing values using JS's standard `==` operator (NodeAutomation keywords are objects, so can only be compared for equality using the `Keyword.compare()` method, not `==`.) [TBC]


### Number

JS represents all numbers internally as 64-bit floats. For compatibility NodeAutomation packs non-fractional numbers as SInt32 where possible.


### Strings

Note that while `typeUnicodeText` was formally deprecated in Mac OS X 10.4+ in favour of `typeUTF8Text` and `typeUTF16ExternalRepresentation`, it is still in common usage so NodeAutomation continues to use it to ensure the broadest compatibility with existing scriptable applications. [TO DO: AFAIK, little has changed since then, so `typeUnicodeText` is still the standard type used by scriptable apps today.]


### Filesystem references

All file-related AE types, both current and deprecated, are represented as `File` objects [TBC: the name might change to `Path` to better describe its purpose]. Currently all file paths are packed and unpacked as `typeFileURL`, coercing as needed; alias and bookmark AE types are not preserved. (Very old Carbon apps may not accept this type; user testing is needed to determine if this will warrant additional compatibility options.) For example, to open a file named `ReadMe.txt` in the `Documents` folder of user `jsmith`:

    var file = File('/Users/jsmith/Documents/ReadMe.txt');
    app('TextEdit').open({_:file});

An absolute POSIX path string is required; relative paths and tilde-based paths are not [currently?] accepted.

To convert a `File` object to POSIX path string:

    var file = File('/Users/jsmith/Documents/ReadMe.txt');
    var path = file.toPath();
    console.log(path);
    //--> '/Users/jsmith/Documents/ReadMe.txt'

To determine if a variable contains a `File` object:
    
    var someVariable = new File('/');
    File.isFile(someVariable);
    //--> true

If dealing with elderly Carbon apps that still use (now-deprecated) colon-delimited HFS path strings:

    var file = File.fromHFSPath('Macintosh HD:Users:jsmith:Documents:ReadMe.txt');
    file.toHFSPath();
    //--> 'Macintosh HD:Users:jsmith:Documents:ReadMe.txt'


### Records

The `typeAERecord` AE type is a struct-like data structure containing zero or more properties. NodeAutomation represents AE records as JS objects. The keys in this dict are usually application-defined keywords (e.g. `name`), although they may also be raw four-char codes (indicated by a `#` prefix) or arbitrary strings (indicated by a `$` prefix).

If an object contains a `class` (or `#pcls`) key, appscript will pack the remaining items into an AE record, then coerce it to the type specified by this `class` property. Similarly, when unpacking an record-like AEDesc with a custom type code, appscript will unpack it as a JS object with its AE type described by a `class` entry.


### Types and enumerators

`typeType`, `typeEnumerated`, `typeProperty` and `typeKeyword` descriptors are unpacked as NodeAutomation keywords, e.g. `k.document`, `k.yes`. If no terminology is available, four-char code strings (indicated by `#` prefix) or OSTypes (SInt32) are used instead, e.g. `k['#foob']`, `k[0x12AB34CD]`.


### Unit types

Unit types (e.g. `2.54 as inches`) are primarily an native AppleScript language feature and generally not supported or used by scriptable applications. Unsupported by NodeAutomation. (If required, they are generally constructed as an `NSAppleEventDescriptor` whose `descriptorType` indicates the unit type and whose `data` contains the numeric value as 64-bit IEEE floating point number.)


### Miscellaneous types

The Apple Event Manager defines many other AE types whose names and codes are defined by NodeAutomation for completeness. A few of these types are of occasional interest to users, the rest can simply be ignored. Unbridged values will be represented as NodObjC-wrapped `NSAppleEventDescriptor` objects (equivalent to `«data TYPE…»` objects in AppleScript).


