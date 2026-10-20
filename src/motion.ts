export const enterMotion = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 4 },
};

export const menuMotion = {
  initial: { opacity: 0, y: 4, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 2, scale: 0.98 },
};

export const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

export const dialogVariants = {
  hidden: { opacity: 0, y: 14, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1 },
};
