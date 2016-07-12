# async-proxy.js
async-proxy.js is a simple helper library enables migrating a whole javascript class to a web-worker.

# Documentation and demo
Can be found here:
http://mamazav.github.io/async-proxy.js/

# Compilation
The library was compiled using Google Closure Compiler:

```
cd src
java -jar closure_compiler.jar --js async-proxy-script-blob.js --js sub-worker-emulation-for-chrome.js --js async-proxy-master.js --js async-proxy-slave.js --js scripts-to-import-pool.js --js linked-list.js --js hash-map.js --js dependency-workers.js --js async-proxy-exports.js --js_output_file ..\async-proxy.dev.js --compilation_level ADVANCED_OPTIMIZATIONS
java -jar closure_compiler.jar --js async-proxy-script-blob.js --js sub-worker-emulation-for-chrome.js --js async-proxy-master.js --js async-proxy-slave.js --js scripts-to-import-pool.js --js linked-list.js --js hash-map.js --js dependency-workers.js --js async-proxy-exports.js --js_output_file ..\async-proxy.dev.debug.js --compilation_level WHITESPACE_ONLY
```

# License
This library is distributed under Apache 2.0 license.
