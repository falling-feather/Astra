const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root=path.resolve(__dirname,'../..');
const source=fs.readFileSync(path.join(root,'shared/js/resource-explorer.js'),'utf8');
for(const enabled of [true,false]){
  const heading={textContent:''};let initialized=0;
  const context=vm.createContext({document:{querySelector:selector=>selector.startsWith('meta')?(enabled?{}:null):heading}});
  context.window=context;
  context.AstraLearningActivityCatalog={entries:()=>[{galaxy_key:'englab'},{galaxy_key:'englab'},{galaxy_key:'future-galaxy'}]};
  context.AstraPageRegistry={rolesFor:page=>page==='teacher'?['teacher']:[]};
  vm.runInContext(source,context);
  assert.equal(context.AstraResourceExplorer.start(()=>initialized++),enabled);
  assert.equal(initialized,enabled?1:0);
  const protectedRoute=context.AstraResourceExplorer.guardRoute({page:'teacher',moduleId:null,anchorId:null});
  assert.equal(protectedRoute.page,enabled?'home':'teacher');
  assert.equal(context.AstraResourceExplorer.guardRoute({page:'physics'}).page,'physics');
  assert.equal(context.AstraApplicationSession,undefined,'public exploration must not fabricate an authenticated session');
  if(enabled)assert.equal(heading.textContent,'Engineering Lab · 2 Experiments');
}
console.log('portal-resource-entry-contract: ok');
