'use strict';

function AsyncProxyFactoryClosure() {
    var asyncProxyScriptBlob = self['asyncProxyScriptBlob'];
    var factorySingleton = {};
	
	factorySingleton.create = function create(scriptsToImport, ctorName, methods, proxyCtor) {
		if (!scriptsToImport || !(scriptsToImport.length > 0)) {
			throw 'AsyncProxyFactory error: missing scriptsToImport (2nd argument)';
		}
		if (!methods) {
			throw 'AsyncProxyFactory error: missing methods (3rd argument)';
		}
		
		var ProxyClass = proxyCtor || function() {
			var that = this;
			this.__workerHelperCtorArgs = convertArgs(arguments);
		};
		
		ProxyClass.prototype['_getWorkerHelper'] = function getWorkerHelper() {
			if (!this.__workerHelper) {
				this.__workerHelper = new AsyncProxyMaster(
					scriptsToImport, ctorName, this.__workerHelperCtorArgs || []);
			}
			
			return this.__workerHelper;
		};
		
		for (var methodName in methods) {
			generateMethod(ProxyClass, methodName, methods[methodName] || []);
		}
		
		return ProxyClass;
	};
	
	function generateMethod(ProxyClass, methodName, methodArgs) {
		if (typeof methodArgs === 'function') {
			ProxyClass.prototype[methodName] = methodArgs;
			return;
		}
		
		var methodOptions = methodArgs[0] || {};
		ProxyClass.prototype[methodName] = function generatedFunction() {
			var argsToSend = [];
			for (var i = 0; i < arguments.length; ++i) {
				if (!methodArgs[i + 1]) {
					argsToSend[i] = arguments[i];
				}
			}
			var argsToSend = convertArgs(arguments);
			return this['_getWorkerHelper']().callFunction(methodName, argsToSend);
		}
	};
	
	function convertArgs(argsObject) {
		var args = new Array(argsObject.length);
		for (var i = 0; i < argsObject.length; ++i) {
			args[i] = argsObject[i];
		}
		
		return args;
	}

	asyncProxyScriptBlob.addMember(AsyncProxyFactoryClosure, 'AsyncProxyFactory');
    
    return factorySingleton;
}

var AsyncProxyFactory = AsyncProxyFactoryClosure();