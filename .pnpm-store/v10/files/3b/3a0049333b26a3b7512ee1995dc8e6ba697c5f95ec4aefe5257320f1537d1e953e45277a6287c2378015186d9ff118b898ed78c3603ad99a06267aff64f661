var p = (n, e) => () => (e || n((e = { exports: {} }).exports, e), e.exports);
var d = (n, e, a) => new Promise((t, i) => {
  var r = (o) => {
    try {
      s(a.next(o));
    } catch (l) {
      i(l);
    }
  }, c = (o) => {
    try {
      s(a.throw(o));
    } catch (l) {
      i(l);
    }
  }, s = (o) => o.done ? t(o.value) : Promise.resolve(o.value).then(r, c);
  s((a = a.apply(n, e)).next());
});
import h from "mermaid";
var b = p((m) => {
  h.initialize({ startOnLoad: !1, securityLevel: "loose" });
  function w(n, e) {
    const t = `%%{init: {"theme": "${e === "dark" ? "dark" : "default"}"}}%%
`;
    return n.trimStart().startsWith("%%{") ? n : t + n;
  }
  function y(n) {
    const e = /^(?:graph|flowchart|flowchart\s+tb|flowchart\s+lr|sequenceDiagram|gantt|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|pie|quadrantChart|timeline|xychart(?:-beta)?)\b/;
    for (let a = 0; a < n.length; a++) {
      const t = n[a].trim();
      if (t && !t.startsWith("%%") && e.test(t))
        return a;
    }
    return -1;
  }
  function u(n, e) {
    return d(this, null, function* () {
      var i;
      const a = w(n, e), t = h;
      if (typeof t.parse == "function")
        return yield (i = t.parse) == null ? void 0 : i.call(t, a), !0;
      throw new Error("mermaid.parse not available in worker");
    });
  }
  function k(n, e) {
    return d(this, null, function* () {
      const a = n.split(`
`), t = y(a);
      if (t === -1)
        return null;
      const i = a.slice(0, t + 1);
      yield u(i.join(`
`), e);
      let r = t + 1, c = a.length, s = t + 1, o = 0;
      const l = 12;
      for (; r <= c && o < l; ) {
        const f = Math.floor((r + c) / 2), g = [...i, ...a.slice(t + 1, f)].join(`
`);
        o++;
        try {
          yield u(g, e), s = f, r = f + 1;
        } catch (j) {
          c = f - 1;
        }
      }
      return [...i, ...a.slice(t + 1, s)].join(`
`);
    });
  }
  self.onmessage = (n) => d(null, null, function* () {
    var i;
    const e = n.data, a = (r) => self.postMessage(r), t = e.id;
    try {
      if (e.action === "canParse") {
        const r = yield u(e.payload.code, e.payload.theme);
        a({ id: t, ok: !0, result: r });
        return;
      }
      if (e.action === "findPrefix") {
        const r = yield k(
          e.payload.code,
          e.payload.theme
        );
        a({ id: t, ok: !0, result: r });
        return;
      }
      a({ id: t, ok: !1, error: "Unknown action" });
    } catch (r) {
      a({ id: t, ok: !1, error: (i = r == null ? void 0 : r.message) != null ? i : String(r) });
    }
  });
});
export default b();
