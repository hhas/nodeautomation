# Specifier examples

## Application objects

    // application "Finder"
       app('Finder');

    // application "Macintosh HD:Applications:TextEdit.app:"
       app('/Applications/TextEdit.app')


## Property references

    // a reference to startup disk of application "Finder"
       app('Finder').startupDisk

    // a reference to name of folder 1 of home of application "Finder"
       app('Finder').home.folders.at(1).name

    // a reference to name of every item of home of application "Finder"
       app('Finder').home.items.name

    // a reference to text of every document of application "TextEdit"
       app('TextEdit').documents.text

    // a reference to color of character 1 of every paragraph ¬
    //     of text of document 1 of application "TextEdit"
       app('TextEdit').documents.at(1).text.paragraphs.characters.at(1).color


## All elements references

    // a reference to disks of application "Finder"
       app('Finder').disks

    // a reference to every word of every paragraph of text of every document ¬
    //     of application "TextEdit"
       app('TextEdit').documents.text.paragraphs.words


## Single element references

    // a reference to disk 1 of application "Finder"
       app('Finder').disks.at(1)

    // a reference to file "ReadMe.txt" of folder "Documents" of home of application "Finder"
       app('Finder').home.folders.named('Documents').files.named('ReadMe.txt')

    // a reference to paragraph -1 of text of document 1 of application "TextEdit"
       app('TextEdit').documents.at(1).text.paragraphs.at(-1)

    // a reference to middle paragraph of text of last document of application "TextEdit"
       app('TextEdit').documents.last.text.paragraphs.middle

    // a reference to any file of home of application "Finder"
       app('Finder').home.files.any


Relative references

    // a reference to paragraph before paragraph 6 of text of document 1 of application "TextEdit"
       app('TextEdit').documents.at(1).text.paragraphs.at(6).previous(k.paragraph)

    // a reference to paragraph after character 30 of document 1 of application "Tex-Edit Plus"
       app('Tex-Edit Plus').documents.at(1).characters.at(30).next(k.paragraph)


Element range references

    // a reference to words 1 thru 4 of text of document 1 of application "TextEdit"
       app('TextEdit').documents.at(1).text.words.thru(1, 4)

    // a reference to paragraphs 2 thru -1 of text of document 1 of application "TextEdit"
       app('TextEdit').documents.at(1).text.paragraphs(2, -1)

    // a reference to folders "Documents" thru "Music" of home of application "Finder"
       app('Finder').home.folders.thru('Documents', 'Music')

    // a reference to text (word 3) thru (paragraph 7) of document 1 of application "Tex-Edit Plus"
       app('Tex-Edit Plus').documents.at(1).text.thru(con.words.at(3), con.paragraphs.at(7))


Filter references

    // a reference to every document of application "TextEdit" whose text is "\n"
       app('TextEdit').documents.where(its.text.eq('\n') // (i.e. all empty paragraphs)

    // a reference to every paragraph of document 1 of application "Tex-Edit Plus" ¬
    //     whose first character is last character
       app('Tex-Edit Plus').documents.at(1).paragraphs.where(
               its.characters.first.eq(its.characters.last))

    // a reference to every file of folder "Documents" of home of application "Finder" ¬
    //     whose name extension is "txt" and size &lt; 10000
       app('Finder').home.folders.named('Documents').files(
            its.nameExtension.eq('txt').and(its.size.lt(10000)


Insertion location references

    // a reference to end of documents of application "TextEdit"
       app('TextEdit').documents.end

    // a reference to before paragraph 1 of text of document 1 of application "TextEdit"
       app('TextEdit').documents.at(1).text.paragraphs.at(1).before

