/**
 * What the wallet SDK expects from a browser, loaded before anything else:
 * TextEncoder, crypto.getRandomValues and Buffer.
 */
import "fast-text-encoding";
import "react-native-get-random-values";
import { Buffer } from "buffer";

const g = globalThis as { Buffer?: typeof Buffer };
g.Buffer ??= Buffer;
