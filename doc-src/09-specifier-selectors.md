# Selecting elements

Once you've constructed an object specifier that identifies all of the elements of an object, you can further refine this selection to specify just one, or several, of those elements in particular. To do this, you call one (or sometimes more) of the following _reference form_ methods:

* `at` 
* `named`
* `ID`
* `first`/`middle`/`last`/`any`
* `previous`/`next`
* `thru`
* `where`
* `beginning`, `end`, `before`, `after`


The following sections explain how to use each of these reference forms.

## `at` (by index)

Identifies a single element object by its position.

### Syntax

    elements.at(selector)


The `selector` value is a non-zero integer representing the object's index position. The first element has index `1`, the second element's index is `2`, the third is `3`, and so on. Negative numbers can be used to count backwards from the last element: `-1` indicates the last element, `-2` the second-to-last, and so on.

### Examples

    words.at(3)
    items.at(-1)


### JS-style shortcuts

When using the `at` method, always remember that the Apple Event Object Model always uses **one-indexing**, not zero-indexing as in JavaScript arrays. As a convenience to JS users who are more used to the latter, NodeAutomation also allows by-index reference forms to be described using JS's traditional `[...]` syntax.

Thus, `words.at(3)` can also be written as:

    words[2]


and `items.at(-1)` as:

    items[-1]

Note that this shortcut _only_ accepts integers and does not work on all object specifiers due to JS's own syntax limitations. (You can still use the standard `at` method, of course.)


### Notes

Some applications also allow non-integer values to be used. For example, Finder also accepts a `File` object that identify a file/folder/disk location anywhere in the file system:

    app('Finder').items.at( new File('/path/to/some/file') )


## `named` (by name)

Identifies the first element with the given name.

### Syntax

    elements.named(selector)


The `selector` value is a string representing the object's name as given in its `name` property.

### Examples

    disks['Macintosh HD']
    files['index.html']


### Notes

Applications usually treat object names as case-insensitive. 

Where multiple element have the same name, a by-name reference only identifies the first element found with that name.  If you wish to identify _all_ elements with the same name, use `where` instead.

## `ID` (by unique identifier)

Identifies a single element using a unique application-supplied key.

### Syntax

    elements.ID(selector)

        selector : anything -- object's id


Examples

    windows.ID(4321)


## `first`/`middle`, `last`, `any` (by absolute position)

Identify the first, middle, or last element, or a randomly chosen element.

### Syntax

    elements.first
    elements.middle
    elements.last
    elements.any


### Examples

    documents.first
    paragraphs.last
    files.any


## `previous`/`next` (by relative position)

Identify a single element before or after (i.e. relative to) this one.

### Syntax

    anElement.previous(className)
    anElement.next(className)


The `className` value is a keyword object indicating the class of the nearest object to select (e.g. `k.document`, `k.folder`). For example, to specify the next folder after 'Music' in the user's home folder:

    app('Finder').home.folders.named('Music').next(k.folder)

If selecting an element of the same type, the `previous`/`next` method's argument can be omitted; thus the above specifier may be written more concisely as:

    app('Finder').home.folders.named('Music').next()

See the Type Conversions chapter for more information on keyword objects.

### Examples

    words.at(3).next()
    paragraphs.at(-1).previous(k.character)


## `thru` (by range)

Identifies all elements between and including the beginning and end of the range.

### Syntax

    elements.thru(start, stop)

The `start` and `stop` values may be integers, strings, and/or `app` or `con`-based specifiers.

When positive integer values are given, the `thru` method (like `at`) starts counting elements from 1, not zero, so `1` indicates the first element, `2` the second, etc.

The beginning and end elements are declared relative to the object containing the elements being selected. NodeAutomation defines a top-level `con` object to indicate the current elements' container, from which you can construct generic specifiers to identify the exact element to use as the start or end of the range. For example, the following generic specifier indicate the third paragraph of the currrent container object:

    con.paragraphs.at(3)


Thus, to select every paragraph from the third through to the second-to-last:

    paragraphs.thru( con.paragraphs.at(3), con.paragraphs.at(-2) )


When the start and end elements are the same class as the elements being selected, which is frequently the case, NodeAutomation allows the same `thru` to be written much more concisely, like this:

    paragraphs.thru(3, -1)


The `thru` method will automatically convert number and string arguments to `con`-based specifiers.

Some applications can understand quite complex range requests. For example, the following will work in Tex-Edit Plus:

    app('Tex-Edit Plus').documents.first.words.thru( con.characters.at(5), 
                                                     con.paragraphs.at(-2) )


### Examples

    documents.thru(1, 3)
    folders.thru('Downloads', 'Movies')
    text.thru( con.characters.at(5), con.words.at(-2) )


### JS-style shortcuts

When using the `thru` method, always remember that the Apple Event Object Model always uses **one-indexing** and always includes both the start and end items in the selection, unlike JavaScript arrays which use zero-indexing and do not end item in the selection. As a convenience to JS users who are more used to the latter, NodeAutomation also allows by-range reference forms to be described using a JS-like `slice` method. Thus, `documents.thru(1, 3)` can also be written as:

    documents.slice(0, 3)


Note that this shortcut _only_ accepts integer values; to construct by-range references in any other way, use `thru`.

## `where` (by test)

Identifies zero or more elements whose properties and/or elements match one or more given tests. (In AppleScript, this is commonly known as a 'whose' (or 'where') clause.)

### Syntax

    elements.where(testSpecifier)


The `testSpecifier` values is composed of the following:


* One or more generic specifiers that identify those properties and/or sub-elements to which a filter test should be applied. 

* For each of those specifiers, the conditional test (e.g. `eq`, `isIn`) to apply to the value it identifies. 

* If more than one test is being performed, or if a true result should produce false and vice-versa, Boolean-style logic tests (`and`/`or`/`not`) should also be used to combine them into a single compound test specifier.


Each specifier to must be constructing using NodeAutomation's top-level `its` object, which represents each of the elements to be tested. For example, to refer to the `name` property of the object(s) being tested:

    its.name

Or, if selecting an application's `document` elements based on the first word in the document's text:

    its.text.words.first


Each `its`-based specifier allow you to apply a single comparison or containment (i.e. condition) test to the property/element(s) being tested. Each method accepts a single value, object, or property/element specifier (i.e. the value to which the specified property or element(s) should be compared).


Comparison tests:

    itsSpecifier.lt(value) // is less than
    itsSpecifier.le(value) // is less than or equal to
    itsSpecifier.eq(value) // is equal to
    itsSpecifier.ne(value) // is not equal to
    itsSpecifier.gt(value) // is greater than
    itsSpecifier.ge(value) // is greater than or equal to


Containment tests:

    itsSpecifier.beginsWith(value)
    itsSpecifier.endsWith(value)
    itsSpecifier.contains(value)
    itsSpecifier.isIn(value)


The following logic tests are supported:

    testSpecifier.and(testSpecifier,...)
    testSpecifier.or(testSpecifier,...)
    testSpecifier.not



**Important:** These are the only operations understood by the `where` reference form. You cannot construct test specifiers using standard JavaScript operators (e.g. `+`, `%`) or functions (`trim`, `round`), as the Apple Event Object Model does not recognize these requests and cannot perform them itself. You can still use these and other JS features to create the number, string, array, etc. values to be used as arguments in comparison and containment tests; however, if you need to perform more complex tests than AEOM allows then you will have to retrieve all of the raw data from the application then use a JS `for` loop to test and filter it yourself.

### Examples:

    its.name.eq('')
    its.size.gt(1024)
    its.words.first.beginsWith('A')
    its.characters.first.eq(its.characters.last)

    its.ne('')
    its.size.gt(1000).and(its.size.lt(100000))

    its.words.at(1).beginsWith('A')
         .or(its.words.at(2).contains('ce'))
         .or(its.words.at(1).eq('Foo'))


When testing certain classes of element, such as words and paragraphs, you can even apply a containment test directly to it. For example, to specify every word that isn't "Wednesday" within the front TextEdit document:

    app('TextEdit').documents.first.words.where( its.ne('Wednesday') )


## `beginning`, `end`, `before`, `after` (insertion location)

Unlike other reference forms, which identify properties or elements, the insertion form identifies locations before/after/between an object's current elements.

### Syntax

    elements.beginning
    elements.end
    anElement.before
    anElement.after


### Examples

    documents.end
    paragraphs.at(1).before
