// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project

export const STYLED_COMPONENTS_DUPLICATED_ENTRIES = 2;

export const cloneClassInstance = classInstance =>
  Object.assign(Object.create(Object.getPrototypeOf(classInstance)), classInstance);

export const cloneAndUpdate = (classInstance, key, value) => {
  const instance = cloneClassInstance(classInstance);
  instance[key] = value;

  return instance;
};
