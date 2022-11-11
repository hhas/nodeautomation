#!/usr/bin/env node 


const na = require('nodeautomation')

const ai = na.app('Adobe Illustrator')



ai.activate()

console.log(ai.documents())

let doc = ai.make({new: na.k.document, withProperties: {name: "test"}})

doc.close({saving: na.k.yes})
