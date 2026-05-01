const relaxedMode = process.env.COMMITLINT_STRICT === "0";

if (relaxedMode) {
  module.exports = {
    rules: {
      "header-min-length": [2, "always", 10],
      "subject-empty": [2, "never"],
    },
  };
} else {
  module.exports = {
    extends: ["@commitlint/config-conventional"],
  };
}
