export const colors = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

export const colorString = (str: string, color: keyof typeof colors) => {
  return `${colors[color]}${str}\x1b[0m`;
}; 