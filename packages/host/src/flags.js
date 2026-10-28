/** @param {import('electron').App} app */
export function createFlag(app) {
  return (/** @type {string} */ name) => {
    if (app.isPackaged) return undefined;
    const joined = process.argv.find((a) => a.startsWith(`${name}=`));
    if (joined) return joined.slice(name.length + 1);
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
}
