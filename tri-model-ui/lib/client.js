// tri-model-ui — BROWSER half (factory-form bundle served as /plugins/tri-model-ui/client.js).
//
// Envelope format mirrors the shipped dsh-client-ui-* bundles:
//   window.__ModuleLoader__.load({ id, factory: (require) => { ... } })
// 
// Registers:
//   1. Toolbar in conversation.input.dock (id=tri-model-toolbar order=30)
//   2. Settings panel in shell.overlay (id=tri-model-settings-panel order=50)
//
// The toolbar shows the three-role mapping and clickable buttons (●kickoff + ⚙settings).
// The settings panel provides UI for models, roles, merge, review, clarify, bounce, safety.
// Both communicate via POST/GET to the host's 4 routes: /tri-model/{get-state,set-config,reset-config,build-command}.
//
window.__ModuleLoader__.load({
  id: "tri-model-ui",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var react = require("react");

    // Kickoff constant for ●三模协同 button
    var KICKOFF = "三模协同：方向师定方向→架构师设计→执行者实施，按 tri-model-config.json 执行。";

    // ============ Pub/Sub for settings panel open/close ============
    var settingsOpen = false;
    var listeners = [];

    function on(callback) {
      listeners.push(callback);
      return function dispose() {
        listeners = listeners.filter(function (cb) { return cb !== callback; });
      };
    }

    function emit() {
      listeners.forEach(function (cb) { return cb(settingsOpen); });
    }

    function setSettingsOpen(open) {
      settingsOpen = open;
      emit();
    }

    // ============ Toolbar (conversation.input.dock) ============
    function Toolbar(props) {
      var session = props.session;
      var input = props.input;
      var inputActions = props.inputActions;
      var sessionId = props.sessionId;
      var useSession = props.useSession;
      var useInput = props.useInput;

      var ref = react.useState(null);
      var state = ref[0];
      var setState = ref[1];

      // Fetch get-state on mount and when settings change
      react.useEffect(function () {
        function fetchState() {
          fetch("/tri-model/get-state")
            .then(function (r) { return r.json(); })
            .then(setState)
            .catch(function () { return setState({ ok: false }); });
        }
        fetchState();
        return on(fetchState);
      }, []);

      function handleKickoff() {
        if (inputActions && inputActions.setDraft) {
          inputActions.setDraft(KICKOFF);
        }
      }

      function handleSettings() {
        setSettingsOpen(!settingsOpen);
      }

      // Extract model short names: gpt-5.4 -> 5.4, deepseek-v4-flash -> v4-flash
      function shortName(id) {
        if (!id) return "?";
        var parts = id.split("-");
        return parts.length > 1 ? parts.slice(1).join("-") : id;
      }

      var roles = state && state.ok && state.roles ? state.roles : null;
      var summary = roles
        ? "方:" + shortName(roles.direction) + " · 架:" + shortName(roles.architecture) + " · 执:" + shortName(roles.execution)
        : "配置缺失";

      return react.createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "4px 8px",
            fontSize: "12px",
            whiteSpace: "nowrap"
          }
        },
        // ● Kickoff button
        react.createElement(
          "button",
          {
            onClick: handleKickoff,
            title: "开始三模协同",
            style: {
              background: "var(--dsw-alias-interactive-bg-hover)",
              border: "1px solid var(--dsw-alias-border-l1)",
              borderRadius: "4px",
              padding: "2px 6px",
              cursor: "pointer",
              fontSize: "12px",
              color: "var(--dsw-alias-label-primary)",
              fontFamily: "inherit"
            }
          },
          "● 三模协同"
        ),
        // Role summary
        react.createElement(
          "span",
          {
            title: state && state.configPath ? "配置: " + state.configPath : "",
            style: {
              fontSize: "11px",
              color: "var(--dsw-alias-label-secondary)",
              flex: "0 1 auto",
              overflow: "hidden",
              textOverflow: "ellipsis"
            }
          },
          summary
        ),
        // ⚙ Settings button
        react.createElement(
          "button",
          {
            onClick: handleSettings,
            title: settingsOpen ? "关闭设置" : "打开设置",
            style: {
              background: "transparent",
              border: "none",
              padding: "2px 4px",
              cursor: "pointer",
              fontSize: "12px",
              color: "var(--dsw-alias-label-secondary)"
            }
          },
          "⚙"
        )
      );
    }

    // ============ Settings Panel (shell.overlay) ============
    function SettingsPanel(props) {
      var ref = react.useState(false);
      var open = ref[0];
      var setOpen = ref[1];

      var ref2 = react.useState(null);
      var state = ref2[0];
      var setState = ref2[1];

      var ref3 = react.useState(null);
      var draft = ref3[0];
      var setDraft = ref3[1];

      var ref4 = react.useState(null);
      var error = ref4[0];
      var setError = ref4[1];

      var ref5 = react.useState(null);
      var buildCmd = ref5[0];
      var setBuildCmd = ref5[1];

      // Subscribe to settings open/close
      react.useEffect(function () {
        return on(function (isOpen) {
          setOpen(isOpen);
          if (isOpen && !draft) {
            // Fetch fresh state when opening
            fetch("/tri-model/get-state")
              .then(function (r) { return r.json(); })
              .then(function (s) {
                setState(s);
                if (s.ok) {
                  setDraft({
                    models: s.models || [],
                    roles: s.roles || {},
                    merge: s.merge || {},
                    review: s.review || {},
                    clarify: s.clarify || {},
                    bounce: s.bounce || {},
                    safety: s.safety || {}
                  });
                }
              })
              .catch(function (e) { return setError("获取配置失败: " + String(e)); });
          }
        });
      }, []);

      function handleSave() {
        setError(null);
        var updates = {};
        var keys = ["models", "roles", "merge", "review", "clarify", "bounce", "safety"];
        keys.forEach(function (k) {
          if (draft && draft[k] != null) {
            updates[k] = draft[k];
          }
        });

        fetch("/tri-model/set-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates: updates })
        })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            if (res.ok) {
              setState(res);
              setDraft(null);
              setError(null);
            } else {
              setError(res.error && res.error.message ? res.error.message : "保存失败");
            }
          })
          .catch(function (e) { return setError("网络错误: " + String(e)); });
      }

      function handleReset() {
        if (!window.confirm("确认重置配置到模板？")) return;
        setError(null);
        fetch("/tri-model/reset-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}"
        })
          .then(function (r) { return r.json(); })
          .then(function (res) {
            if (res.ok) {
              setState(res);
              setDraft(null);
              setError(null);
            } else {
              setError(res.error && res.error.message ? res.error.message : "重置失败");
            }
          })
          .catch(function (e) { return setError("网络错误: " + String(e)); });
      }

      function handleBuildCommand() {
        setError(null);
        fetch("/tri-model/build-command")
          .then(function (r) {
            return r.text().then(function (text) {
              return { ok: r.ok, text: text };
            });
          })
          .then(function (res) {
            if (res.ok) {
              setBuildCmd(res.text);
            } else {
              setError(res.text);
            }
          })
          .catch(function (e) { return setError("获取命令失败: " + String(e)); });
      }

      function handleCopyCommand() {
        if (buildCmd && navigator.clipboard) {
          navigator.clipboard
            .writeText(buildCmd)
            .catch(function () { return setError("复制失败"); });
        }
      }

      if (!open || !state || !state.ok) {
        return null;
      }

      var panelStyle = {
        position: "fixed",
        bottom: "60px",
        right: "12px",
        width: "360px",
        maxWidth: "calc(100vw - 24px)",
        maxHeight: "calc(100vh - 120px)",
        zIndex: 100,
        background: "var(--dsw-alias-bg-overlay)",
        border: "1px solid var(--dsw-alias-border-l2)",
        borderRadius: "10px",
        padding: "12px",
        boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        color: "var(--dsw-alias-label-primary)",
        pointerEvents: "auto",
        overflow: "auto",
        fontFamily: "inherit"
      };

      var sectionStyle = {
        marginBottom: "12px",
        paddingBottom: "12px",
        borderBottom: "1px solid var(--dsw-alias-border-l1)"
      };

      var labelStyle = {
        display: "block",
        fontSize: "11px",
        fontWeight: 600,
        color: "var(--dsw-alias-label-secondary)",
        marginBottom: "4px",
        textTransform: "uppercase"
      };

      var inputStyle = {
        width: "100%",
        padding: "4px 6px",
        fontSize: "12px",
        border: "1px solid var(--dsw-alias-border-l1)",
        borderRadius: "4px",
        background: "var(--dsw-alias-bg-layer-1)",
        color: "var(--dsw-alias-label-primary)",
        fontFamily: "inherit"
      };

      var buttonStyle = {
        padding: "6px 12px",
        fontSize: "12px",
        border: "1px solid var(--dsw-alias-border-l1)",
        borderRadius: "4px",
        background: "var(--dsw-alias-interactive-bg-hover)",
        color: "var(--dsw-alias-label-primary)",
        cursor: "pointer",
        fontFamily: "inherit"
      };

      return react.createElement(
        "div",
        { style: panelStyle },
        // Header with close button
        react.createElement(
          "div",
          { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" } },
          react.createElement("div", { style: { fontSize: "13px", fontWeight: 600 } }, "三模协同设置"),
          react.createElement(
            "button",
            {
              onClick: function () { return setSettingsOpen(false); },
              style: { background: "none", border: "none", fontSize: "16px", cursor: "pointer", color: "var(--dsw-alias-label-secondary)" }
            },
            "✕"
          )
        ),

        // Error display
        error
          ? react.createElement(
              "div",
              {
                style: {
                  marginBottom: "12px",
                  padding: "8px",
                  borderRadius: "4px",
                  background: "rgba(255,0,0,0.1)",
                  color: "rgba(255,0,0,0.8)",
                  fontSize: "12px"
                }
              },
              error
            )
          : null,

        // 1. Models cost
        react.createElement(
          "div",
          { style: sectionStyle },
          react.createElement("label", { style: labelStyle }, "1. 模型成本"),
          (state.models || []).map(function (model) {
            return react.createElement(
              "div",
              { key: model.id, style: { marginBottom: "6px", display: "flex", gap: "8px", alignItems: "center" } },
              react.createElement("span", { style: { fontSize: "11px", flex: "0 0 80px", color: "var(--dsw-alias-label-secondary)" } }, model.id),
              react.createElement(
                "select",
                {
                  value: model.billing || "",
                  onChange: function (e) {
                    if (draft && draft.models) {
                      var updated = draft.models.map(function (m) {
                        return m.id === model.id ? Object.assign({}, m, { billing: e.target.value }) : m;
                      });
                      setDraft(Object.assign({}, draft, { models: updated }));
                    }
                  },
                  style: Object.assign({}, inputStyle, { flex: 1 })
                },
                (state.billingTiers || []).map(function (tier) {
                  return react.createElement("option", { key: tier.key, value: tier.key }, tier.label);
                })
              )
            );
          })
        ),

        // 2. Role assignment
        react.createElement(
          "div",
          { style: sectionStyle },
          react.createElement("label", { style: labelStyle }, "2. 角色分配"),
          ["direction", "architecture", "execution"].map(function (role) {
            var label = role === "direction" ? "方向师" : role === "architecture" ? "架构师" : "执行者";
            var isPerCallForbidden =
              draft &&
              draft.models &&
              draft.roles &&
              state.forbiddenRolesByBilling &&
              state.forbiddenRolesByBilling["per-call"] &&
              state.forbiddenRolesByBilling["per-call"].includes(role);
            var selectedModel = draft && draft.roles ? draft.roles[role] : null;
            var isSelectedPerCall =
              selectedModel &&
              state.models &&
              state.models.find(function (m) { return m.id === selectedModel && m.billing === "per-call"; });

            return react.createElement(
              "div",
              { key: role, style: { marginBottom: "6px", display: "flex", gap: "8px", alignItems: "center" } },
              react.createElement("span", { style: { fontSize: "11px", flex: "0 0 60px", color: "var(--dsw-alias-label-secondary)" } }, label),
              react.createElement(
                "select",
                {
                  value: selectedModel || "",
                  onChange: function (e) {
                    if (draft) {
                      setDraft(Object.assign({}, draft, { roles: Object.assign({}, draft.roles, Object.defineProperty({}, role, { value: e.target.value, enumerable: true })) }));
                    }
                  },
                  disabled: isSelectedPerCall && isPerCallForbidden,
                  style: Object.assign({}, inputStyle, { flex: 1, opacity: isSelectedPerCall && isPerCallForbidden ? 0.5 : 1 })
                },
                react.createElement("option", { value: "" }, "--"),
                (state.models || []).map(function (model) {
                  var disabled = model.billing === "per-call" && isPerCallForbidden;
                  return react.createElement(
                    "option",
                    { key: model.id, value: model.id, disabled: disabled },
                    model.id + (disabled ? " (禁止)" : "")
                  );
                })
              )
            );
          })
        ),

        // 3. Merge mode
        react.createElement(
          "div",
          { style: sectionStyle },
          react.createElement("label", { style: labelStyle }, "3. 合并模式"),
          react.createElement(
            "div",
            { style: { display: "flex", gap: "8px", alignItems: "center", marginBottom: "6px" } },
            react.createElement(
              "input",
              {
                type: "checkbox",
                checked: (draft && draft.merge && draft.merge.enabled) || false,
                onChange: function (e) {
                  if (draft) {
                    setDraft(Object.assign({}, draft, { merge: Object.assign({}, draft.merge, { enabled: e.target.checked }) }));
                  }
                },
                style: { cursor: "pointer" }
              }
            ),
            react.createElement("span", { style: { fontSize: "12px" } }, "启用")
          ),
          (draft && draft.merge && draft.merge.enabled) || false
            ? react.createElement(
                "select",
                {
                  value: (draft && draft.merge && draft.merge.mode) || "",
                  onChange: function (e) {
                    if (draft) {
                      setDraft(Object.assign({}, draft, { merge: Object.assign({}, draft.merge, { mode: e.target.value }) }));
                    }
                  },
                  style: inputStyle
                },
                (state.merge && state.merge.options || []).map(function (opt) {
                  return react.createElement("option", { key: opt, value: opt }, opt);
                })
              )
            : null
        ),

        // 4. Review
        react.createElement(
          "div",
          { style: sectionStyle },
          react.createElement("label", { style: labelStyle }, "4. 审阅"),
          react.createElement(
            "select",
            {
              value: (draft && draft.review && draft.review.mode) || "",
              onChange: function (e) {
                if (draft) {
                  setDraft(Object.assign({}, draft, { review: Object.assign({}, draft.review, { mode: e.target.value }) }));
                }
              },
              style: inputStyle
            },
            (state.review && state.review.options || []).map(function (opt) {
              return react.createElement("option", { key: opt, value: opt }, opt);
            })
          )
        ),

        // 5. Clarify
        react.createElement(
          "div",
          { style: sectionStyle },
          react.createElement("label", { style: labelStyle }, "5. 澄清"),
          react.createElement(
            "div",
            { style: { display: "flex", gap: "8px", alignItems: "center" } },
            react.createElement(
              "input",
              {
                type: "checkbox",
                checked: (draft && draft.clarify && draft.clarify.enabled) || false,
                onChange: function (e) {
                  if (draft) {
                    setDraft(Object.assign({}, draft, { clarify: { enabled: e.target.checked } }));
                  }
                },
                style: { cursor: "pointer" }
              }
            ),
            react.createElement("span", { style: { fontSize: "12px" } }, "启用")
          )
        ),

        // 6. Bounce
        react.createElement(
          "div",
          { style: sectionStyle },
          react.createElement("label", { style: labelStyle }, "6. 冒泡"),
          react.createElement(
            "div",
            { style: { display: "flex", gap: "8px", alignItems: "center" } },
            react.createElement(
              "input",
              {
                type: "checkbox",
                checked: (draft && draft.bounce && draft.bounce.enabled) || false,
                onChange: function (e) {
                  if (draft) {
                    setDraft(Object.assign({}, draft, { bounce: { enabled: e.target.checked } }));
                  }
                },
                style: { cursor: "pointer" }
              }
            ),
            react.createElement("span", { style: { fontSize: "12px" } }, "启用")
          )
        ),

        // 7. Safety (gitSnapshot only)
        react.createElement(
          "div",
          { style: sectionStyle },
          react.createElement("label", { style: labelStyle }, "7. 安全"),
          react.createElement(
            "div",
            { style: { display: "flex", gap: "8px", alignItems: "center" } },
            react.createElement(
              "input",
              {
                type: "checkbox",
                checked: (draft && draft.safety && draft.safety.gitSnapshot) || false,
                onChange: function (e) {
                  if (draft) {
                    setDraft(Object.assign({}, draft, { safety: { gitSnapshot: e.target.checked } }));
                  }
                },
                style: { cursor: "pointer" }
              }
            ),
            react.createElement("span", { style: { fontSize: "12px" } }, "Git 快照")
          )
        ),

        // Build command section
        react.createElement(
          "div",
          { style: Object.assign({}, sectionStyle, { borderBottom: "none" }) },
          react.createElement("label", { style: labelStyle }, "生成命令"),
          react.createElement(
            "div",
            { style: { display: "flex", gap: "6px", marginBottom: "8px" } },
            react.createElement(
              "button",
              {
                onClick: handleBuildCommand,
                style: Object.assign({}, buttonStyle, { flex: 1 })
              },
              "生成"
            ),
            buildCmd
              ? react.createElement(
                  "button",
                  {
                    onClick: handleCopyCommand,
                    style: buttonStyle
                  },
                  "复制"
                )
              : null
          ),
          buildCmd
            ? react.createElement("textarea", {
                value: buildCmd,
                readOnly: true,
                style: Object.assign({}, inputStyle, { minHeight: "60px", resize: "vertical", fontFamily: "monospace", fontSize: "11px" })
              })
            : null
        ),

        // Action buttons
        react.createElement(
          "div",
          { style: { display: "flex", gap: "8px", marginTop: "12px" } },
          react.createElement(
            "button",
            {
              onClick: handleSave,
              style: Object.assign({}, buttonStyle, { flex: 1, fontWeight: 600 })
            },
            "保存"
          ),
          react.createElement(
            "button",
            {
              onClick: handleReset,
              style: Object.assign({}, buttonStyle, { flex: 1 })
            },
            "重置"
          )
        )
      );
    }

    // ============ Registration ============
    function apply(ctx) {
      var slots = ctx.get("slots");
      if (slots === undefined) return;

      // Register toolbar in conversation.input.dock
      slots.inject("conversation.input.dock", function () {
        return slots.register(
          { name: "conversation.input.dock", id: "tri-model-toolbar", order: 30 },
          Toolbar
        );
      });

      // Register settings panel in shell.overlay
      slots.inject("shell.overlay", function () {
        return slots.register(
          { name: "shell.overlay", id: "tri-model-settings-panel", order: 50 },
          SettingsPanel
        );
      });
    }

    exports.inject = ["slots"];
    exports.apply = apply;
    return module.exports;
  }
});
