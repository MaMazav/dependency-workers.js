'use strict';

function PromiseDependencyWorkersClosure(DependencyWorkers) {
    var asyncProxyScriptBlob = self['asyncProxyScriptBlob'];
    
    function PromiseDependencyWorkers(promiseInputRetreiver) {
        var inputRetreiver = new PromiseWrapperInputRetreiver(promiseInputRetreiver);
        DependencyWorkers.call(this, inputRetreiver);
    }
    
    PromiseDependencyWorkers.prototype = Object.create(DependencyWorkers.prototype);
    
    asyncProxyScriptBlob.addMember(PromiseDependencyWorkersClosure, 'PromiseDependencyWorkers', null, 'DependencyWorkers');
    
    return PromiseDependencyWorkers;
}

var PromiseDependencyWorkers = PromiseDependencyWorkersClosure(DependencyWorkers);