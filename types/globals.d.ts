declare module "*.css" {
  const content: { [className: string]: string } | string;
  export default content;
}

declare module "*.scss" {
  const content: { [className: string]: string } | string;
  export default content;
}

declare module "*.module.css" {
  const content: { [className: string]: string };
  export default content;
}

declare module "*.module.scss" {
  const content: { [className: string]: string };
  export default content;
}

// Allow importing the package-scoped CSS path used in the repo
declare module "@workspace/ui/*.css" {
  const content: { [className: string]: string } | string;
  export default content;
}
