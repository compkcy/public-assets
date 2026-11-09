import test from 'node:test';import assert from 'node:assert/strict';import{merge,validate,csvCell}from'./model.js';
const a={id:'a',name:'A',products:[{id:'p',types:[],effects:[],answers:{}}],photos:[]};
test('backup validation',()=>{assert.equal(validate({schemaVersion:1,suppliers:[a]}),true);assert.equal(validate({schemaVersion:2,suppliers:[a]}),false);assert.equal(validate({schemaVersion:1,suppliers:[{...a,photos:[{data:'javascript:bad'}]}]}),false);});
test('duplicates and conflicts preserve existing data',()=>{assert.equal(merge([a],[a]).length,1);const x=merge([a],[{...a,name:'edited'}]);assert.equal(x.length,2);assert.equal(x[0].name,'A');assert.notEqual(x[1].id,a.id);});
test('csv escapes formula and quotation',()=>{assert.equal(csvCell('=SUM(A1)'), '"\'=SUM(A1)"');assert.equal(csvCell('a"b'),'"a""b"');});
