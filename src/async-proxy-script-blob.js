'use strict';

var BlobScriptGenerator = BlobScriptGeneratorClosure();
self['asyncProxyScriptBlob'] = new BlobScriptGenerator();

function BlobScriptGeneratorClosure() {
    function BlobScriptGenerator() {
        var that = this;
        that._blobChunks = ['\'use strict\';'];
        that._blob = null;
        that._blobUrl = null;
        that._namespaces = {};
        
        that.addMember(BlobScriptGeneratorClosure, 'BlobScriptGenerator');
        that.addStatement('var asyncProxyScriptBlob = new BlobScriptGenerator();');
    }
    
    BlobScriptGenerator.prototype.addMember = function addMember(
        closureFunction, memberName, namespace) {
        
        if (this._blob) {
            throw new Error('Cannot add member to AsyncProxyScriptBlob after blob was used');
        }
        
        if (memberName) {
            if (namespace) {
                this._namespaces[namespace] = true;
                this._blobChunks.push(namespace);
                this._blobChunks.push('.');
            } else {
                this._blobChunks.push('var ');
            }
            
            this._blobChunks.push(memberName);
            this._blobChunks.push(' = ');
        }
        
        this._blobChunks.push('(');
        this._blobChunks.push(closureFunction.toString());
        this._blobChunks.push(')();');
    };
    
    BlobScriptGenerator.prototype.addStatement = function addStatement(statement) {
        if (this._blob) {
            throw new Error('Cannot add statement to AsyncProxyScriptBlob after blob was used');
        }
        
        this._blobChunks.push(statement);
    };
    
    BlobScriptGenerator.prototype.getBlob = function getBlob() {
        if (!this._blob) {
            this._blob = new Blob(this._blobChunks, { type: 'application/javascript' });
        }
        
        return this._blob;
    };
    
    BlobScriptGenerator.prototype.getBlobUrl = function getBlobUrl() {
        if (!this._blobUrl) {
            this._blobUrl = URL.createObjectURL(this.getBlob());
        }
        
        return this._blobUrl;
    };

    return BlobScriptGenerator;
}