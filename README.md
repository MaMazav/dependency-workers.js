# AsyncProxy.js
AsyncProxy.js is a simple helper library enables migrating a whole javascript class to a web-worker.

# Documentation and demo
Can be found here:
http://mamazav.github.io/asyncproxy.js/

# Compilation
The library was compiled using Google Closure Compiler:

```
cd src
java -jar closure_compiler.jar --js asyncproxyscriptblob.js --js subworkerimulationforchrome.js --js asyncproxymaster.js --js asyncproxyslave.js --js scriptstoimportpool.js --js asyncproxyexports.js --js_output_file ..\async-proxy.dev.js --compilation_level ADVANCED_OPTIMIZATIONS
java -jar closure_compiler.jar --js asyncproxyscriptblob.js --js subworkerimulationforchrome.js --js asyncproxymaster.js --js asyncproxyslave.js --js scriptstoimportpool.js --js asyncproxyexports.js --js_output_file ..\async-proxy.dev.debug.js --compilation_level WHITESPACE_ONLY
```

# License
This library is distributed under Apache 2.0 license.
