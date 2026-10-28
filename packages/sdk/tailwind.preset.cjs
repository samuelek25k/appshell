module.exports = {
  theme: {
    extend: {
      colors: {
        bg: 'var(--ui-bg)',
        panel: 'var(--ui-panel)',
        line: 'var(--ui-line)',
        ink: 'var(--ui-ink)',
        quiet: 'var(--ui-quiet)',
        accent: 'var(--ui-accent)',
        'accent-ink': 'var(--ui-accent-ink)',
        'accent-tint': 'var(--ui-accent-tint)',
        danger: 'var(--ui-danger)',
        'danger-tint': 'var(--ui-danger-tint)',
      },
      borderRadius: { ui: 'var(--ui-radius)', 'ui-lg': 'var(--ui-radius-lg)' },
      fontFamily: { ui: ['var(--ui-font)'] },
    },
  },
};
