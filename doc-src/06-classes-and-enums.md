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


Occasionally an application defines a type or enumerator without providing it with a corresponding name name. In these cases, the value will be represented as a raw AE code, e.g. `k.fromTypeCode('#ABCD')`. To construct `Keyword` objects using raw AE codes:

<pre><code>k.fromTypeCode(<var>code</var>)
k.fromEnumCode(<var>code</var>)</code></pre>

Raw codes may be written as four-char strings (printable ASCII characters only) prefixed with a hash character, '#', or as unsigned 32-bit integers, e.g. 0x.

To determine if a variable contains a `Keyword` object:
    
    var v = k.document;
    k.isKeyword(v);
    //--> true

To compare two `Keyword` objects:

    var v = k.documentFile;
    k.documentFile.isEqual(v);
    //--> true


`Keyword` objects are packed as `typeType` or `typeEnumerated` descriptors, depending on how they are defined in the target application's dictionary.


## Common AE types

[TO DO: need to provide table of AE type -> keyword name -> JavaScript type mappings, e.g. `typeInteger` -> `k.integer` -> JS `number`]


## Type mapping notes

While AE-JS type conversions generally work quite seamlessly, it is sometimes useful to know some of the details involved, particularly when troubleshooting code that deals with older or buggy applications.


### Undefined

NodeAutomation throws on `undefined`.


### Null

For convenience, NodeAutomation maps Apple events' `missing value` constant to JavaScript's `null` value. This makes it easy to check for missing values using the standard `===` operator.


### Number

JavaScript represents all numbers internally as 64-bit floats. For compatibility NodeAutomation packs non-fractional numbers as SInt32 where possible.


### Strings

Note that while `typeUnicodeText` was formally deprecated in Mac OS X 10.4+ in favour of `typeUTF8Text` and `typeUTF16ExternalRepresentation`, it remains the standard AE text type used by scriptable apps today.


### Filesystem references

All file-related AE types, both current and deprecated, are represented as `File` objects. All file paths are packed and unpacked as `typeFileURL`, coercing as needed; alias and bookmark AE types are not preserved. For example, to open a file named `ReadMe.txt` in the `Documents` folder of user `jsmith`:

    var file = File('/Users/jsmith/Documents/ReadMe.txt');
    app('TextEdit').open({_:file});

An absolute POSIX path string is required; relative paths and tilde-based paths are not [currently?] accepted.

To convert a `File` object to POSIX path string:

    var file = File('/Users/jsmith/Documents/ReadMe.txt');
    var path = String(file);
    console.log(path);
    //--> '/Users/jsmith/Documents/ReadMe.txt'

To determine if a variable contains a `File` object:
    
    var v = new File('/Users/jsmith');
    File.isFile(v);
    //--> true

To compare two `File` objects (note: this only checks for exact path string equality):

    var v = new File('/Users/jsmith');
    new File('/Users/jsmith').isEqual(v);
    //--> true

For backwards compatibility with elderly Carbon apps that only accept (now-deprecated) colon-delimited HFS path strings:

    var file = File.fromHFSPath('Macintosh HD:Users:jsmith:Documents:ReadMe.txt');
    file.toHFSPath();
    //--> 'Macintosh HD:Users:jsmith:Documents:ReadMe.txt'


### Records

The `typeAERecord` AE type is a struct-like data structure containing zero or more properties. NodeAutomation represents AE records as JavaScript objects. The keys in this dict are usually application-defined keywords (e.g. `name`), although they may also be raw four-char codes (indicated by a `#` prefix) or arbitrary strings (indicated by a `$` prefix).

If an object contains a `class` (or `#pcls`) key, appscript will pack the remaining items into an AE record, then coerce it to the type specified by this `class` property. Similarly, when unpacking an record-like AEDesc with a custom type code, appscript will unpack it as a JavaScript object with its AE type described by a `class` entry.


### Unbridged types

Unit types (e.g. `2.54 as inches`) are primarily an native AppleScript language feature and generally not supported or used by scriptable applications. Unsupported by NodeAutomation. (If required, they are generally constructed as an `NSAppleEventDescriptor` whose `descriptorType` indicates the unit type and whose `data` contains the numeric value as 64-bit IEEE floating point number.)

The Apple Event Manager defines many other AE types whose names and codes are defined by NodeAutomation for completeness. A few of these types are of occasional interest to users, the rest can simply be ignored. Unbridged values will be represented as NodObjC-wrapped `NSAppleEventDescriptor` objects (equivalent to `«data TYPE…»` objects in AppleScript).


