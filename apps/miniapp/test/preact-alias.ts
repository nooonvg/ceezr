/**
 * # preact-alias — الاختباراتُ تُشغَّلُ على الإطارِ نفسِه الذي يُشحَن (PRD-009 · ADR 0258)
 *
 * **الغرض:** البناءُ يُحِلُّ `react`/`react-dom` إلى `preact/compat` (`vite.config.ts`).
 * ولو بقيَت الاختباراتُ على React لاختبرَت إطارًا غيرَ المشحون. هذا التحميلُ المسبقُ
 * (`bunfig.toml` ← `[test].preload`) يُطبِّقُ الإحلالَ نفسَه في `bun test`.
 *
 * **ما لا يفعلُه:** لا يمسُّ الأنواع: `tsc` يبقى على `@types/react` (واجهةُ `compat` مطابقة).
 */
import { plugin } from "bun";

/**
 * `onResolve` لا يُطبَّقُ على المحدِّداتِ العاريةِ في مُشغِّلِ الاختبارات (Bun 1.4.2، مُجرَّب)،
 * فنعترضُ **تحميلَ** ملفّاتِ نقاطِ دخولِ `react`/`react-dom` ونستبدلُ محتواها بإعادةِ تصديرِ
 * المقابلِ من Preact. أيُّ نقطةِ دخولٍ غيرِ مُعرَّفةٍ تُسقِطُ الاختبارَ صراحةً لا صمتًا.
 */
const ENTRY: Record<string, { target: string; hasDefault: boolean }> = {
  "react/index.js": { target: "preact/compat", hasDefault: true },
  "react/jsx-runtime.js": { target: "preact/jsx-runtime", hasDefault: false },
  "react/jsx-dev-runtime.js": { target: "preact/jsx-runtime", hasDefault: false },
  "react-dom/index.js": { target: "preact/compat", hasDefault: true },
  "react-dom/client.js": { target: "preact/compat/client", hasDefault: false },
  "react-dom/server.js": { target: "preact/compat/server", hasDefault: true },
  "react-dom/server.node.js": { target: "preact/compat/server", hasDefault: true },
  "react-dom/server.bun.js": { target: "preact/compat/server", hasDefault: true },
  "react-dom/test-utils.js": { target: "preact/test-utils", hasDefault: false },
};

plugin({
  name: "preact-alias",
  setup(build) {
    build.onLoad(
      {
        filter:
          /[\\/]node_modules[\\/](?:\.bun[\\/][^\\/]+[\\/]node_modules[\\/])?react(?:-dom)?[\\/][^\\/]+\.js$/,
      },
      (args) => {
        const m = /[\\/](react(?:-dom)?)[\\/]([^\\/]+\.js)$/.exec(args.path);
        const key = m ? `${m[1]}/${m[2]}` : args.path;
        const entry = ENTRY[key];
        if (entry === undefined) throw new Error(`preact-alias: نقطةُ دخولٍ غيرُ مُعرَّفة ${key}`);
        const abs = Bun.resolveSync(entry.target, import.meta.dir);
        const contents = `export * from ${JSON.stringify(abs)};${entry.hasDefault ? `export { default } from ${JSON.stringify(abs)};` : ""}`;
        return { contents, loader: "js" };
      },
    );
  },
});
