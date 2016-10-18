'use strict';

function WrapperInputRetreiverBaseClosure() {
    var asyncProxyScriptBlob = self['asyncProxyScriptBlob'];
    
    function WrapperInputRetreiverBase(inputRetreiver) {
        //if (!inputRetreiver['getHashCode']) {
        //    throw 'AsyncProxy.DependencyWorkers: No ' +
        //        'inputRetreiver.getHashCode() method';
        //}
        //if (!inputRetreiver['isEqual']) {
        //    throw 'AsyncProxy.DependencyWorkers: No ' +
        //        'inputRetreiver.isEqual() method';
        //}
        if (!inputRetreiver['getTaskOptions']) {
            throw 'AsyncProxy.DependencyWorkers: No ' +
                'inputRetreiver.getTaskOptions() method';
        }

        var that = this;
        that._inputRetreiver = inputRetreiver;
    }
    
    WrapperInputRetreiverBase.prototype.createTaskContext =
            function createTaskContext(taskKey, callbacks) {
        
        throw 'AsyncProxy.WrapperInputRetreiverBase internal error: Not implemented createTaskContext()';
    };
    
    //WrapperInputRetreiverBase.prototype.getHashCode = function(key) {
    //    return this._inputRetreiver['getHashCode'](key);
    //};
    //
    //WrapperInputRetreiverBase.prototype.isEqual = function(key1, key2) {
    //    return this._inputRetreiver['isEqual'](key1, key2);
    //};
    
    
    WrapperInputRetreiverBase.prototype.getTaskOptions = function(taskType) {
        return this._inputRetreiver['getTaskOptions'](taskType);
    };
    
    asyncProxyScriptBlob.addMember(
        WrapperInputRetreiverBaseClosure, 'WrapperInputRetreiverBase');
    
    return WrapperInputRetreiverBase;
}

var WrapperInputRetreiverBase = WrapperInputRetreiverBaseClosure();