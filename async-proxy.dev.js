var u=t();self.asyncProxyScriptBlob=new u;
function t(){function b(){this.g=["'use strict';"];this.da=this.H=null;this.cb={};this.j(t,"BlobScriptGenerator");this.v("var asyncProxyScriptBlob = new BlobScriptGenerator();")}b.prototype.j=function(c,a,f,b){if(this.H)throw Error("Cannot add member to AsyncProxyScriptBlob after blob was used");a&&(f?(this.cb[f]=!0,this.g.push(f),this.g.push(".")):this.g.push("var "),this.g.push(a),this.g.push(" = "));this.g.push("(");this.g.push(c.toString());this.g.push(")(");this.g.push(b||"");this.g.push(");")};
b.prototype.v=function(c){if(this.H)throw Error("Cannot add statement to AsyncProxyScriptBlob after blob was used");this.g.push(c)};b.prototype.getBlob=function(){this.H||(this.H=new Blob(this.g,{type:"application/javascript"}));return this.H};b.prototype.pb=function(){this.da||(this.da=URL.createObjectURL(this.getBlob()));return this.da};return b};function v(){function b(f){if(null===a)throw"AsyncProxy internal error: SubWorkerEmulationForChrome not initialized";this.X=++c;a[this.X]=this;self.postMessage({type:"subWorkerCtor",F:this.X,Bb:f})}var c=0,a=null;b.ta=function(c){a=c};b.prototype.postMessage=function(a,c){self.postMessage({type:"subWorkerPostMessage",F:this.X,data:a},c)};b.prototype.terminate=function(a,c){self.postMessage({type:"subWorkerTerminate",F:this.X},c)};self.asyncProxyScriptBlob.j(v,"SubWorkerEmulationForChrome");return b}
var w=v();function x(){function b(f,e,P,d){var n=this;d=d||{};var r=c.toString(),r=r.replace("SCRIPT_PLACEHOLDER",g.pb()),r=URL.createObjectURL(new Blob(["(",r,")()"],{type:"application/javascript"}));n.h=[];n.J=[];n.la=[];n.ma=[];n.$=new Worker(r);n.$.onmessage=function(c){a(n,c)};n.oa=null;n.T=0;n.Da=d.functionsBufferSize||5;n.ja=[];n.$.postMessage({qa:"ctor",Cb:f,ob:e,C:P,b:++h,Pa:!1,wb:b.Ma()})}function c(){importScripts("SCRIPT_PLACEHOLDER");AsyncProxy.AsyncProxySlave=self.AsyncProxy.AsyncProxySlaveSingleton;
AsyncProxy.AsyncProxySlave.bb()}function a(a,c){var b=c.data.b;switch(c.data.type){case "functionCalled":--a.T;d(a);break;case "promiseResult":var e=a.J[b];delete a.J[b];e.resolve(c.data.result);break;case "promiseFailure":e=a.J[b];delete a.J[b];e.reject(c.data.reason);break;case "userData":null!==a.oa&&a.oa(c.data.Kb);break;case "callback":b=a.h[c.data.b];if(void 0===b)throw"Unexpected message from SlaveWorker of callback ID: "+c.data.b+". Maybe should indicate isMultipleTimesCallback = true on creation?";
b.ua||a.La(a.h[c.data.b]);null!==b.Ka&&b.Ka.apply(null,c.data.C);break;case "subWorkerCtor":var b=new Worker(c.data.Bb),g=c.data.F;a.la[g]=b;a.ma.push(b);b.onmessage=function(c){f(a,c.ports,!1,{qa:"subWorkerOnMessage",F:g,data:c.data})};break;case "subWorkerPostMessage":b=a.la[c.data.F];b.postMessage(c.data.data);break;case "subWorkerTerminate":b=a.la[c.data.F];b.terminate();break;default:throw"Unknown message from AsyncProxySlave of type: "+c.data.type;}}function f(a,c,b,f){a.T>=a.Da?a.ja.push({Jb:c,
ub:b,message:f}):e(a,c,b,f)}function e(a,c,b,f){b&&++a.T;a.$.postMessage(f,c)}function d(a){for(;a.T<a.Da&&0<a.ja.length;){var c=a.ja.shift();e(a,c.Jb,c.ub,c.message)}}var g=self.asyncProxyScriptBlob,h=0,k=!1,m=function(){var a=location.href,c=a.lastIndexOf("/");0<=c&&(a=a.substring(0,c));return a}();b.prototype.Gb=function(a){this.oa=a};b.prototype.terminate=function(){this.$.terminate();for(var a=0;a<this.ma.length;++a)this.ma[a].terminate()};b.prototype.Ja=function(a,c,b){b=b||{};var d=!!b.isReturnPromise,
g=b.transferables,k=b.pathsToTransferablesInPromiseResult,l=++h,m=null,q=this;d&&(m=new Promise(function(a,c){q.J[l]={resolve:a,reject:c}}));(b.isSendImmediately?e:f)(this,g,!0,{qa:a,C:c||[],b:l,Pa:d,zb:k});if(d)return m};b.prototype.Lb=function(a,c,b){b=b||{};var f=++h;c={vb:!0,ua:!!b.isMultipleTimeCallback,b:f,mb:c,Sa:b.pathsToTransferables};this.h[f]={ua:!!b.isMultipleTimeCallback,b:f,Ka:a,Sa:b.pathsToTransferables};return c};b.prototype.La=function(a){delete this.h[a.b]};b.Ma=function(){k=!0;
return m};b.hb=function(a){if(m!==a&&k)throw"Previous values returned from getMasterEntryUrl is wrong. Avoid calling it within the slave c`tor";m=a};g.j(x,"AsyncProxyMaster");return b}var y=x();function z(){function b(){var a;try{for(var c=k.split("."),b=self,e=0;e<c.length;++e)b=b[c[e]];var c=b,d=[null].concat(f(arguments));a=new (Function.prototype.bind.apply(c,d))}catch(g){throw Error("Failed locating class name "+k+": "+g);}return a}function c(a,c){if(void 0!==a){for(var b=Array(a.length),f=0;f<a.length;++f){for(var e=a[f],d=c,g=0;g<e.length;++g)d=d[e[g]];b[f]=d}return b}}function a(a){var c=a.data.qa,f=a.data.C,d=a.data.b,n=a.data.Pa,m=a.data.zb;switch(c){case "ctor":self.AsyncProxy.AsyncProxyMaster.hb(a.data.wb);
d=a.data.Cb;k=a.data.ob;for(var l=0;l<d.length;++l)importScripts(d[l]);g=b.apply(null,f);return;case "subWorkerOnMessage":h[a.data.F].onmessage({data:a.data.data});return}f=Array(a.data.C.length);for(l=0;l<a.data.C.length;++l){var p=a.data.C[l];void 0!==p&&null!==p&&p.vb&&(p=e.Xa(p));f[l]=p}for(var l=g,q;l&&!(q=g[c]);)l=l.__proto__;if(!q)throw"AsyncProxy error: could not find function "+q;f=q.apply(g,f);n&&e.Ya(d,f,m);self.postMessage({type:"functionCalled",b:a.data.b,result:null})}function f(a){for(var c=
Array(a.length),b=0;b<a.length;++b)c[b]=a[b];return c}var e={},d=null,g,h={},k;e.bb=function(){self.onmessage=a};e.Fb=function(a){b=a};e.Eb=function(a){d=a};e.Db=function(a){self.postMessage({type:"userData",Kb:a})};e.Ya=function(a,b,f){b.then(function(b){var e=c(f,b);self.postMessage({type:"promiseResult",b:a,result:b},e)})["catch"](function(c){self.postMessage({type:"promiseFailure",b:a,reason:c})})};e.Xa=function(a){var b=!1;return function(){if(b)throw"Callback is called twice but isMultipleTimeCallback = false";
var e=f(arguments);if(null!==d)try{d.call(g,"callback",a.mb,e)}catch(h){console.log("AsyncProxySlave.beforeOperationListener has thrown an exception: "+h)}var k=c(a.Sa,e);self.postMessage({type:"callback",b:a.b,C:e},k);a.ua||(b=!0)}};e.fa=function(){return A.fa(Error())};if(void 0===self.Worker){var m=self.SubWorkerEmulationForChrome;m.ta(h);self.Worker=m}self.asyncProxyScriptBlob.j(z,"AsyncProxySlaveSingleton");return e}var B=z();function C(){function b(){this.ka={};this.K=null}b.prototype.lb=function(c){c=b.fa(c);this.ka[c]||(this.ka[c]=!0,this.K=null)};b.prototype.rb=function(){if(null===this.K){this.K=[];for(var c in this.ka)this.K.push(c)}return this.K};b.fa=function(c){var a=c.stack.trim(),b=/at (|[^ ]+ \()([^ ]+):\d+:\d+/.exec(a);if(b&&""!==b[2])return b[2];if((b=(new RegExp(/.+\/(.*?):\d+(:\d+)*$/)).exec(a))&&""!==b[1])return b[1];if(void 0!=c.fileName)return c.fileName;throw"ImageDecoderFramework.js: Could not get current script URL";
};self.asyncProxyScriptBlob.j(C,"ScriptsToImportPool");return b}var A=C();var D=function(){function b(){this.clear()}b.prototype.clear=function(){this.ea={A:null,U:this};this.R={w:null,U:this};this.i=0;this.R.A=this.ea;this.ea.w=this.R};b.prototype.add=function(c,a){if(null===a||void 0===a)a=this.R;this.Z(a);++this.i;var b={kb:c,w:a,A:a.A,U:this};b.A.w=b;return a.A=b};b.prototype.remove=function(c){this.Z(c);--this.i;c.A.w=c.w;c.w.A=c.A;c.U=null};b.prototype.m=function(c){this.Z(c);return c.kb};b.prototype.l=function(){return this.o(this.ea)};b.prototype.o=function(c){this.Z(c);
return c.w===this.R?null:c.w};b.prototype.Z=function(c){if(c.U!==this)throw"iterator must be of the current LinkedList";};return b}();var E=function(){function b(c){this.S=[];this.G=new D;this.P=c;this.i=0}b.prototype.Na=function(c){var a=this.P.getHashCode(c),a=this.S[a];if(!a)return null;for(var a=a.list,b=a.l();null!==b;){var e=a.m(b);if(this.P.isEqual(e.key,c))return e.value;b=a.o(b)}return null};b.prototype.m=function(c){return c.c.list.m(c.f).value};b.prototype.Aa=function(c,a){var b=this.P.getHashCode(c),e=this.S[b];e||(e={tb:b,list:new D,xa:null},e.xa=this.G.add(e),this.S[b]=e);b={c:e,f:null};for(b.f=e.list.l();null!==b.f;){var d=
e.list.m(b.f);if(this.P.isEqual(d.key,c))return{iterator:b,va:!1,value:d.value};b.f=e.list.o(b.f)}d=a();b.f=e.list.add({key:c,value:d});++this.i;return{iterator:b,va:!0,value:d}};b.prototype.remove=function(c){var a=c.c.list.i;c.c.list.remove(c.f);var b=c.c.list.i;this.i+=b-a;0===b&&(this.G.remove(c.c.xa),delete this.S[c.c.tb])};b.prototype.l=function(){var c=this.G.l(),a=null,b=null;null!==c&&(a=this.G.m(c),b=a.list.l());return null===b?null:{c:a,f:b}};b.prototype.o=function(c){for(var a={c:c.c,
f:c.c.list.o(c.f)};null===a.f;){var b=this.G.o(c.c.xa);if(null===b)return null;a.c=this.G.m(b);a.f=a.c.list.l()}return a};return b}();function F(){function b(a,c,b,d){this.L=d;this.$a=c;this.Za=b;this.gb=a;this.ga=new E(d);this.pa=[];if(!d.createTaskContext)throw"AsyncProxy.DependencyWorkers: No workerInputRetreiver.createTaskContext() method";if(!d.getHashCode)throw"AsyncProxy.DependencyWorkers: No workerInputRetreiver.getHashCode() method";if(!d.isEqual)throw"AsyncProxy.DependencyWorkers: No workerInputRetreiver.isEqual() method";}var c=self.asyncProxyScriptBlob;b.prototype.za=function(a,c){var b=this.ga.Aa(a,function(){return new G}),
d=b.value,g=new H(d,c);b.va&&(d.ta(a,this,this.ga,b.iterator,this.L),this.ib(d));return g};b.prototype.sb=function(a){a=this.ga.Na(a);return null===a?null:a.ba};b.prototype.ib=function(a){taskContext=this.L.createTaskContext(a.ca,{onDataReadyToProcess:function(c,d){if(a.aa)throw"AsyncProxy.DependencyWorkers: already terminated";a.M?(a.ya=c,a.wa=!0,a.Ta=d):b.Ia(a,c,d)},onTerminated:a.yb,registerTaskDependency:a.Ab});a.ba=taskContext;if(!taskContext.statusUpdated)throw"AsyncProxy.DependencyWorkers: missing taskContext.statusUpdated()";
if(!taskContext.onDependencyTaskResult)throw"AsyncProxy.DependencyWorkers: missing taskContext.onDependencyTaskResult()";var b=this};b.prototype.Ia=function(a,b,c){var d=this;if(c)a.Ra(b);else{var g;g=0<d.pa.length?d.pa.pop():new y(d.gb,d.$a,d.Za);a.M=!0;a.N();g.Ja("start",[b,a.ca],{isReturnPromise:!0}).then(function(b){a.Ra(b);return b})["catch"](function(a){console.log("Error in DependencyWorkers' worker: "+a);return a}).then(function(b){d.pa.push(g);a.M=!1;a.N();if(a.wa){var c=a.ya;a.wa=!1;a.ya=
null;d.Ia(a,c,a.Ta);return b}})}};c.j(F,"DependencyWorkers");return b}var I=F();var H=function J(){function c(a,c){this.a=a;this.ha=0;this.h=c;this.Y=a.u.add(this)}c.prototype.sa=function(){return this.a.Oa};c.prototype.ra=function(){return this.a.Qa};c.prototype.Va=function(a){if(!this.Y)throw"AsyncProxy.DependencyWorkers: Already unregistered";a=a>this.a.D?a:this.ha<this.a.D?this.a.D:this.a.Ua();this.a.Wa(a)};c.prototype.unregister=function(){if(!this.Y)throw"AsyncProxy.DependencyWorkers: Already unregistered";this.a.u.remove(this.Y);this.Y=null;if(0==this.a.u.i)this.a.aa||
(this.a.ended(),this.a.N());else if(this.ha===this.a.D){var a=this.a.Ua();this.a.Wa(a)}};asyncProxyScriptBlob.j(J,"DependencyWorkersTaskHandle");return c}();var G=function(){function b(){this.aa=!1;this.D=0;this.Qa=null;this.wa=this.M=this.Oa=!1;this.ya=null;this.Ta=!1;this.ba=null;this.u=new D;this.yb=this.eb.bind(this);this.Ab=this.fb.bind(this);this.ca=null;this.Ca=0;this.s=this.ia=this.Ga=this.Fa=null}b.prototype.ta=function(b,a,f,e,d){this.ca=b;this.Fa=a;this.Ga=f;this.ia=e;this.s=new E(d)};b.prototype.ended=function(){for(var b=this.s.l();null!=b;){var a=this.s.m(b).O,b=this.s.o(b);a.unregister()}for(b=this.u.l();null!=b;)if(a=this.u.m(b),b=this.u.o(b),
a.h.onTerminated)a.h.onTerminated();this.u.clear();this.s=[];this.Ga.remove(this.ia);this.ia=null};b.prototype.Wa=function(b){if(this.D!==b){this.D=b;this.N();for(var a=this.s.l();null!=a;){var f=this.s.m(a).O,a=this.s.o(a);f.Va(b)}}};b.prototype.N=function(){this.ba.statusUpdated({priority:this.D,hasListeners:0<this.u.i,isIdle:!this.M,terminatedDependsTasks:this.Ca,dependsTasks:this.s.i})};b.prototype.Ua=function(){for(var b=this.u,a=b.l(),f=0;null!=a;)f=b.m(a).ha,a=b.o(a);return f};b.prototype.Ra=
function(b){this.Oa=!0;this.Qa=b;for(var a=this.u,f=a.l();null!=f;){var e=a.m(f),f=a.o(f);e.h.onData(b,this.ca)}};b.prototype.eb=function(){if(this.aa)throw"AsyncProxy.DependencyWorkers: already terminated";if(this.M)throw"AsyncProxy.DependencyWorkers: Cannot terminate while task is processing. Wait for statusUpdated() callback with isIdle == true";this.aa=!0;this.ended()};b.prototype.ab=function(){++this.Ca;this.N()};b.prototype.fb=function(b){function a(a){e.ba.onDependencyTaskResult(a,b);d=!0}
var f=this.s.Aa(b,function(){return{O:null}});if(!f.va)throw"AsyncProxy.DependencyWorkers: Cannot add task dependency twice";var e=this,d=!1,g=!1;f.value.O=this.Fa.za(b,{onData:a,onTerminated:function(){if(g)throw"AsyncProxy.DependencyWorkers: Double termination";g=!0;e.ab()}});setTimeout(function(){!d&&f.value.O.sa()&&a(f.O.ra())})};return b}();function K(){function b(a,b,c,d){this.jb=a;this.I=b;this.L=c;this.h=d;this.W=null;this.Ha=[];this.Ea=[];this.B=1;this.Ba();for(a=0;a<b.length;++a)d.registerTaskDependency(b[a])}var c=self.asyncProxyScriptBlob;Object.defineProperty(b.prototype,"dependsOnTasks",{get:function(){return this.I}});b.prototype.xb=function(a,b){if(1!==this.B)throw"AsyncProxy.PromiseTask: Internal Error: not waiting for tasks depends on";if(null===this.W){this.W=new E(this.L);for(var c=0;c<this.I.length;++c)this.W.Aa(this.I[c],
function(){return c})}var d=this.W.Na(b);if(null===d)throw"AsyncProxy.PromiseTask: Task is not depends on key";this.Ha[d]=a;this.Ea[d]||(this.Ea[d]=!0)};b.prototype.Ib=function(a){!a.hasListeners&&a.isIdle?this.na("No listeners"):1===this.B?this.Ba(a):a.isIdle&&3===this.B&&this.na()};b.prototype.Ba=function(a){var b=0;a&&(b=a.terminatedDependsTasks);if(b===this.I.length){var c=this;this.B=2;this.L.preWorkerProcess(this.Ha,this.I,this.jb).then(function(a){4!==c.B&&(c.B=3,c.h.onDataReadyToProcess(a))})["catch"](function(a){c.na(a)})}};
b.prototype.na=function(a){4!==this.B&&(this.B=4,this.h.onTerminated(a))};c.j(K,"PromiseTask");return b}var L=K();function M(){function b(a){if(!a.getDependsOnTasks)throw"AsyncProxy.DependencyWorkers: No promiseInputRetreiver.getDependsOnTasks() method";if(!a.preWorkerProcess)throw"AsyncProxy.DependencyWorkers: No promiseInputRetreiver.preWorkerProcess() method";if(!a.getHashCode)throw"AsyncProxy.DependencyWorkers: No promiseInputRetreiver.getHashCode() method";if(!a.isEqual)throw"AsyncProxy.DependencyWorkers: No promiseInputRetreiver.isEqual() method";this.V=a}var c=self.asyncProxyScriptBlob;b.prototype.nb=
function(a,b){var c=this.V.getDependsOnTasks(a);return new L(a,c,this.V,b)};b.prototype.qb=function(a){return this.V.getHashCode(a)};b.prototype.isEqual=function(a,b){return this.V.isEqual(a,b)};c.j(M,"PromiseWrapperInputRetreiver");return b}var N=M();function O(b){function c(a,c,d,g){g=new N(g);b.call(this,a,c,d,g)}var a=self.asyncProxyScriptBlob;c.prototype=Object.create(b.prototype);c.prototype.Hb=function(a){var b=this;return new Promise(function(c,g){var h=b.za(a,{onData:function(a){k=!0;m=a},onTerminated:function(){k?c(m):g("AsyncProxy.PromiseDependencyWorkers: Internal error - task terminated but no data returned")}}),k=h.sa(),m;k&&(m=h.ra())})};a.j(O,"PromiseDependencyWorkers",null,"DependencyWorkers");return c}var Q=O(I);function R(){asyncProxyScriptBlob.j(R,"ExportAsyncProxySymbols");asyncProxyScriptBlob.v("ExportAsyncProxySymbols(SubWorkerEmulationForChrome, AsyncProxySlaveSingleton, AsyncProxyMaster, ScriptsToImportPool, DependencyWorkers, DependencyWorkersTaskHandle, PromiseTask, PromiseWrapperInputRetreiver, PromiseDependencyWorkers);");asyncProxyScriptBlob.v("self['AsyncProxy']['AsyncProxySlaveSingleton'] = AsyncProxySlaveSingleton;");asyncProxyScriptBlob.v("self['AsyncProxy']['AsyncProxyMaster'] = AsyncProxyMaster;");
asyncProxyScriptBlob.v("self['AsyncProxy']['ScriptsToImportPool'] = ScriptsToImportPool;");asyncProxyScriptBlob.v("self['AsyncProxy']['DependencyWorkers'] = DependencyWorkers;");asyncProxyScriptBlob.v("self['AsyncProxy']['PromiseTask'] = PromiseTask;");asyncProxyScriptBlob.v("self['AsyncProxy']['PromiseWrapperInputRetreiver'] = PromiseWrapperInputRetreiver;");asyncProxyScriptBlob.v("self['AsyncProxy']['PromiseDependencyWorkers'] = PromiseDependencyWorkers;");return function(b,c,a,f,e,d,g,h,k){self.AsyncProxy=
self.AsyncProxy||{};b.prototype.postMessage=b.prototype.postMessage;b.prototype.terminate=b.prototype.terminate;c.setSlaveSideCreator=c.Fb;c.setBeforeOperationListener=c.Eb;c.sendUserDataToMaster=c.Db;c.wrapPromiseFromSlaveSide=c.Ya;c.wrapCallbackFromSlaveSide=c.Xa;a.prototype.setUserDataHandler=a.prototype.Gb;a.prototype.terminate=a.prototype.terminate;a.prototype.callFunction=a.prototype.Ja;a.prototype.wrapCallback=a.prototype.Lb;a.prototype.freeCallback=a.prototype.La;a.getEntryUrl=a.Ma;f.prototype.addScriptFromErrorWithStackTrace=
f.prototype.lb;f.prototype.getScriptsForWorkerImport=f.prototype.rb;e.prototype.startTask=e.prototype.za;e.prototype.getTaskContext=e.prototype.sb;d.prototype.hasData=d.prototype.sa;d.prototype.getLastData=d.prototype.ra;d.prototype.setPriority=d.prototype.Va;d.prototype.unregister=d.prototype.unregister;g.prototype.onDependencyTaskResult=g.prototype.xb;g.prototype.statusUpdated=g.prototype.Ib;h.prototype.createTaskContext=h.prototype.nb;h.prototype.getHashCode=h.prototype.qb;h.prototype.isEqual=
h.prototype.isEqual;k.prototype.startTaskPromise=k.prototype.Hb}}R()(w,B,y,A,I,H,L,N,Q);self.AsyncProxy.AsyncProxySlaveSingleton=B;self.AsyncProxy.AsyncProxyMaster=y;self.AsyncProxy.ScriptsToImportPool=A;self.AsyncProxy.DependencyWorkers=I;self.AsyncProxy.PromiseTask=L;self.AsyncProxy.PromiseWrapperInputRetreiver=N;self.AsyncProxy.PromiseDependencyWorkers=Q;
