// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project

import Console from 'global/console';
import {ascending, descending} from 'd3-array';

import {
  TRIP_POINT_FIELDS,
  SORT_ORDER,
  ALL_FIELD_TYPES,
  ALTITUDE_FIELDS,
  SCALE_TYPES
} from '@kepler.gl/constants';
import {
  RGBColor,
  Field,
  FieldPair,
  FieldDomain,
  Filter,
  ProtoDataset,
  FilterRecord,
  FilterDatasetOpt,
  RangeFieldDomain,
  SelectFieldDomain,
  MultiSelectFieldDomain,
  TimeRangeFieldDomain
} from '@kepler.gl/types';

import {getGpuFilterProps, getDatasetFieldIndexForFilter} from './gpu-filter-utils';

import {
  getSortingFunction,
  timeToUnixMilli,
  createDataContainer,
  DataForm,
  diffFilters,
  filterDataByFilterTypes,
  FilterResult,
  getFilterFunction,
  getFilterProps,
  getFilterRecord,
  getNumericFieldDomain,
  getTimestampFieldDomain,
  getLinearDomain,
  getLogDomain,
  getOrdinalDomain,
  getQuantileDomain,
  DataContainerInterface,
  FilterChanged
} from '@kepler.gl/utils';
import {generateHashId, notNullorUndefined} from '@kepler.gl/common-utils';

// TODO isolate layer type, depends on @kepler.gl/layers
type Layer = any;

export type GpuFilter = {
  filterRange: number[][];
  filterValueUpdateTriggers: {
    [id: string]: {name: string; domain0: number} | null;
  };
  filterValueAccessor: (
    dc: DataContainerInterface
  ) => (
    getIndex?: (any) => number,
    getData?: (dc_: DataContainerInterface, d: any, fieldIndex: number) => any
  ) => (d: any, objectInfo?: {index: number}) => (number | number[])[];
};

export type FilterProps =
  | NumericFieldFilterProps
  | BooleanFieldFilterProps
  | StringFieldFilterProps
  | TimeFieldFilterProps;

export type NumericFieldFilterProps = RangeFieldDomain & {
  value: [number, number];
  type: string;
  typeOptions: string[];
  gpu: boolean;
  columnStats?: Record<string, any>;
};
export type BooleanFieldFilterProps = SelectFieldDomain & {
  type: string;
  value: boolean;
  gpu: boolean;
  columnStats?: Record<string, any>;
};
export type StringFieldFilterProps = MultiSelectFieldDomain & {
  type: string;
  value: string[];
  gpu: boolean;
  columnStats?: Record<string, any>;
};
export type TimeFieldFilterProps = TimeRangeFieldDomain & {
  type: string;
  view: Filter['view'];
  fixedDomain: boolean;
  value: number[];
  gpu: boolean;
  columnStats?: Record<string, any>;
};

// Unique identifier of each field
const FID_KEY = 'name';

export function maybeToDate(
  isTime: boolean,
  fieldIdx: number,
  format: string,
  dc: DataContainerInterface,
  // An object with row index or a materialized row array (for materialized hover info from trip layer)
  d: {index: number} | any[]
) {
  if (isTime) {
    return timeToUnixMilli(Array.isArray(d) ? d[fieldIdx] : dc.valueAt(d.index, fieldIdx), format);
  }

  return Array.isArray(d) ? d[fieldIdx] : dc.valueAt(d.index, fieldIdx);
}

class KeplerTable<F extends Field = Field> {
  readonly id: string;

  type?: string;
  label: string;
  color: RGBColor;

  // fields and data
  fields: F[] = [];

  dataContainer: DataContainerInterface;

  allIndexes: number[] = [];
  filteredIndex: number[] = [];
  filteredIdxCPU?: number[];
  filteredIndexForDomain: number[] = [];
  fieldPairs: FieldPair[] = [];
  gpuFilter: GpuFilter;
  filterRecord?: FilterRecord;
  filterRecordCPU?: FilterRecord;
  changedFilters?: FilterChanged;

  // table-injected metadata
  sortColumn?: {
    // column name: sorted idx
    [key: string]: string; // ASCENDING | DESCENDING | UNSORT
  };
  sortOrder?: number[] | null;

  pinnedColumns?: string[];
  supportedFilterTypes?: string[] | null;
  disableDataOperation?: boolean;

  // table-injected metadata
  metadata: Record<string, any>;

  getFileProcessor?: (data: any, inputFormat?: string) => {data: any; format: string};

  constructor({
    info,
    color,
    metadata,
    supportedFilterTypes = null,
    disableDataOperation = false
  }: {
    info?: ProtoDataset['info'];
    color: RGBColor;
    metadata?: ProtoDataset['metadata'];
    supportedFilterTypes?: ProtoDataset['supportedFilterTypes'];
    disableDataOperation?: ProtoDataset['disableDataOperation'];
  }) {
    // TODO - what to do if validation fails? Can kepler handle exceptions?
    // const validatedData = validateInputData(data);
    // if (!validatedData) {
    //   return this;
    // }

    const datasetInfo = {
      id: generateHashId(4),
      label: 'new dataset',
      type: '',
      ...info
    };

    const defaultMetadata = {
      id: datasetInfo.id,
      // @ts-ignore
      format: datasetInfo.format || '',
      label: datasetInfo.label || ''
    };

    this.id = datasetInfo.id;
    this.type = datasetInfo.type;
    this.label = datasetInfo.label;
    this.color = color;
    this.metadata = {
      ...defaultMetadata,
      ...metadata
    };

    this.supportedFilterTypes = supportedFilterTypes;
    this.disableDataOperation = disableDataOperation;

    this.dataContainer = createDataContainer([]);
    this.gpuFilter = getGpuFilterProps([], this.id, [], undefined);
  }

  async importData({data}: {data: ProtoDataset['data']}) {
    const dataContainerData = data.cols ? data.cols : data.rows;
    const inputDataFormat = data.cols ? DataForm.COLS_ARRAY : DataForm.ROWS_ARRAY;

    const dataContainer = createDataContainer(dataContainerData, {
      fields: data.fields,
      inputDataFormat
    });

    const fields: Field[] = data.fields.map((f, i) => ({
      ...f,
      fieldIdx: i,
      id: f.name,
      displayName: f.displayName || f.name,
      analyzerType: f.analyzerType || ALL_FIELD_TYPES.string,
      format: f.format || '',
      valueAccessor: getFieldValueAccessor(f, i, dataContainer)
    }));

    const allIndexes = dataContainer.getPlainIndex();
    this.dataContainer = dataContainer;
    this.allIndexes = allIndexes;
    this.filteredIndex = allIndexes;
    this.filteredIndexForDomain = allIndexes;
    this.fieldPairs = findPointFieldPairs(fields);
    // @ts-expect-error Make sure that fields satisfies F extends Field
    this.fields = fields;
    this.gpuFilter = getGpuFilterProps([], this.id, fields, undefined);
  }

  /**
   * update table with new data
   * @param data - new data e.g. the arrow data with new batches loaded
   */
  async update(data: ProtoDataset['data']) {
    const dataContainerData = data.cols ? data.cols : data.rows;
    this.dataContainer.update?.(dataContainerData);
    this.allIndexes = this.dataContainer.getPlainIndex();
    this.filteredIndex = this.allIndexes;
    this.filteredIndexForDomain = this.allIndexes;

    return this;
  }

  get length() {
    return this.dataContainer.numRows();
  }

  /**
   * Get field
   * @param columnName
   */
  getColumnField(columnName: string): F | undefined {
    const field = this.fields.find(fd => fd[FID_KEY] === columnName);
    this._assetField(columnName, field);
    return field;
  }

  /**
   * Get fieldIdx
   * @param columnName
   */
  getColumnFieldIdx(columnName: string): number {
    const fieldIdx = this.fields.findIndex(fd => fd[FID_KEY] === columnName);
    this._assetField(columnName, Boolean(fieldIdx > -1));
    return fieldIdx;
  }

  /**
   * Get displayFormat
   * @param columnName
   */
  getColumnDisplayFormat(columnName) {
    const field = this.fields.find(fd => fd[FID_KEY] === columnName);
    this._assetField(columnName, field);
    return field?.displayFormat;
  }

  /**
   * Get the value of a cell
   */
  getValue(columnName: string, rowIdx: number): any {
    const field = this.getColumnField(columnName);
    return field ? field.valueAccessor({index: rowIdx}) : null;
  }

  /**
   * Updates existing field with a new object
   * @param fieldIdx
   * @param newField
   */
  updateColumnField(fieldIdx: number, newField: F): void {
    this.fields = Object.assign([...this.fields], {[fieldIdx]: newField});
  }

  /**
   * Update dataset color by custom color
   * @param newColor
   */
  updateTableColor(newColor: RGBColor): void {
    this.color = newColor;
  }

  /**
   * Save filterProps to field and retrieve it
   * @param columnName
   */
  getColumnFilterProps(columnName: string): F['filterProps'] | null | undefined {
    const fieldIdx = this.getColumnFieldIdx(columnName);
    if (fieldIdx < 0) {
      return null;
    }
    const field = this.fields[fieldIdx];
    if (Object.prototype.hasOwnProperty.call(field, 'filterProps')) {
      return field.filterProps;
    }

    const fieldDomain = this.getColumnFilterDomain(field);
    if (!fieldDomain) {
      return null;
    }

    const filterProps = getFilterProps(field, fieldDomain);
    const newField = {
      ...field,
      filterProps
    };

    this.updateColumnField(fieldIdx, newField);

    return filterProps;
  }

  /**
   * Apply filters to dataset, return the filtered dataset with updated `gpuFilter`, `filterRecord`, `filteredIndex`, `filteredIndexForDomain`
   * @param filters
   * @param layers
   * @param opt
   */
  filterTable(filters: Filter[], layers: Layer[], opt?: FilterDatasetOpt): KeplerTable<Field> {
    const {dataContainer, id: dataId, filterRecord: oldFilterRecord, fields} = this;

    // if there is no filters
    const filterRecord = getFilterRecord(dataId, filters, opt || {});

    this.filterRecord = filterRecord;
    this.gpuFilter = getGpuFilterProps(filters, dataId, fields, this.gpuFilter);

    this.changedFilters = diffFilters(filterRecord, oldFilterRecord);

    if (!filters.length) {
      this.filteredIndex = this.allIndexes;
      this.filteredIndexForDomain = this.allIndexes;
      return this;
    }

    // generate 2 sets of filter result
    // filteredIndex used to calculate layer data
    // filteredIndexForDomain used to calculate layer Domain
    const shouldCalDomain = Boolean(this.changedFilters.dynamicDomain);
    const shouldCalIndex = Boolean(this.changedFilters.cpu);

    let filterResult: FilterResult = {};
    if (shouldCalDomain || shouldCalIndex) {
      const dynamicDomainFilters = shouldCalDomain ? filterRecord.dynamicDomain : null;
      const cpuFilters = shouldCalIndex ? filterRecord.cpu : null;

      const filterFuncs = filters.reduce((acc, filter) => {
        const fieldIndex = getDatasetFieldIndexForFilter(this.id, filter);
        const field = fieldIndex !== -1 ? fields[fieldIndex] : null;

        return {
          ...acc,
          [filter.id]: getFilterFunction(field, this.id, filter, layers, dataContainer)
        };
      }, {});

      filterResult = filterDataByFilterTypes(
        {dynamicDomainFilters, cpuFilters, filterFuncs},
        dataContainer
      );
    }

    this.filteredIndex = filterResult.filteredIndex || this.filteredIndex;
    this.filteredIndexForDomain =
      filterResult.filteredIndexForDomain || this.filteredIndexForDomain;

    return this;
  }

  /**
   * Apply filters to a dataset all on CPU, assign to `filteredIdxCPU`, `filterRecordCPU`
   * @param filters
   * @param layers
   */
  filterTableCPU(filters: Filter[], layers: Layer[]): KeplerTable<Field> {
    const opt = {
      cpuOnly: true,
      ignoreDomain: true
    };

    // no filter
    if (!filters.length) {
      this.filteredIdxCPU = this.allIndexes;
      this.filterRecordCPU = getFilterRecord(this.id, filters, opt);
      return this;
    }

    // no gpu filter
    if (!filters.find(f => f.gpu)) {
      this.filteredIdxCPU = this.filteredIndex;
      this.filterRecordCPU = getFilterRecord(this.id, filters, opt);
      return this;
    }

    // make a copy for cpu filtering
    const copied = copyTable(this);

    copied.filterRecord = this.filterRecordCPU;
    copied.filteredIndex = this.filteredIdxCPU || [];

    const filtered = copied.filterTable(filters, layers, opt);

    this.filteredIdxCPU = filtered.filteredIndex;
    this.filterRecordCPU = filtered.filterRecord;

    return this;
  }

  /**
   * Calculate field domain based on field type and data
   * for Filter
   */
  getColumnFilterDomain(field: F): FieldDomain {
    const {dataContainer} = this;
    const {valueAccessor} = field;

    let domain;

    switch (field.type) {
      case ALL_FIELD_TYPES.real:
      case ALL_FIELD_TYPES.integer:
        // calculate domain and step
        return getNumericFieldDomain(dataContainer, valueAccessor);

      case ALL_FIELD_TYPES.boolean:
        return {domain: [true, false]};

      case ALL_FIELD_TYPES.string:
      case ALL_FIELD_TYPES.h3:
      case ALL_FIELD_TYPES.date:
        domain = getOrdinalDomain(dataContainer, valueAccessor);
        return {domain};

      case ALL_FIELD_TYPES.timestamp:
        return getTimestampFieldDomain(dataContainer, valueAccessor);

      default:
        return {domain: getOrdinalDomain(dataContainer, valueAccessor)};
    }
  }

  /**
   *  Get the domain of this column based on scale type
   */
  getColumnLayerDomain(field: F, scaleType: string): number[] | string[] | [number, number] | null {
    const {dataContainer, filteredIndexForDomain} = this;

    if (!SCALE_TYPES[scaleType]) {
      Console.error(`scale type ${scaleType} not supported`);
      return null;
    }

    const {valueAccessor} = field;
    const indexValueAccessor = i => valueAccessor({index: i});
    const sortFunction = getSortingFunction(field.type);

    switch (scaleType) {
      case SCALE_TYPES.ordinal:
      case SCALE_TYPES.customOrdinal:
      case SCALE_TYPES.point:
        // do not recalculate ordinal domain based on filtered data
        // don't need to update ordinal domain every time
        return getOrdinalDomain(dataContainer, valueAccessor);

      case SCALE_TYPES.quantile:
        return getQuantileDomain(filteredIndexForDomain, indexValueAccessor, sortFunction);

      case SCALE_TYPES.log:
        return getLogDomain(filteredIndexForDomain, indexValueAccessor);

      case SCALE_TYPES.quantize:
      case SCALE_TYPES.linear:
      case SCALE_TYPES.sqrt:
      case SCALE_TYPES.custom:
      default:
        return getLinearDomain(filteredIndexForDomain, indexValueAccessor);
    }
  }

  /**
   * Get a sample of rows to calculate layer boundaries
   */
  // getSampleData(rows)

  /**
   * Parse cell value based on column type and return a string representation
   * Value the field value, type the field type
   */
  // parseFieldValue(value, type)

  // sortDatasetByColumn()

  /**
   * Assert whether field exist
   * @param fieldName
   * @param condition
   */
  _assetField(fieldName: string, condition: any): void {
    if (!condition) {
      Console.error(`${fieldName} doesnt exist in dataset ${this.id}`);
    }
  }
}

export type Datasets = {
  [key: string]: KeplerTable<Field>;
};

// HELPER FUNCTIONS (MAINLY EXPORTED FOR TEST...)
// have to double excape
const specialCharacterSet = `[#_&@\\.\\-\\ ]`;

function foundMatchingFields(re, suffixPair, allNames, fieldName) {
  const partnerIdx = allNames.findIndex(
    d => d === fieldName.replace(re, match => match.replace(suffixPair[0], suffixPair[1]))
  );
  let altIdx = -1;
  if (partnerIdx > -1) {
    // if found partner, go on and look for altitude
    ALTITUDE_FIELDS.some(alt => {
      altIdx = allNames.findIndex(
        d => d === fieldName.replace(re, match => match.replace(suffixPair[0], alt))
      );
      return altIdx > -1;
    });
  }
  return {partnerIdx, altIdx};
}
/**
 * Find point fields pairs from fields
 *
 * @param fields
 * @returns found point fields
 */
export function findPointFieldPairs(fields: Field[]): FieldPair[] {
  const allNames = fields.map(f => f.name.toLowerCase());

  // get list of all fields with matching suffixes
  const acc: FieldPair[] = [];
  return allNames.reduce((carry, fieldName, idx) => {
    // This search for pairs will early exit if found.
    for (const suffixPair of TRIP_POINT_FIELDS) {
      // match first suffix
      // (^|[#_&@\.\-\ ])lat([#_&@\.\-\ ]|$)
      const re = new RegExp(`(^|${specialCharacterSet})${suffixPair[0]}(${specialCharacterSet}|$)`);

      if (re.test(fieldName)) {
        const {partnerIdx, altIdx} = foundMatchingFields(re, suffixPair, allNames, fieldName);

        if (partnerIdx > -1) {
          const trimName = fieldName.replace(re, '').trim();

          carry.push({
            defaultName: trimName || 'point',
            pair: {
              lat: {
                fieldIdx: idx,
                value: fields[idx].name
              },
              lng: {
                fieldIdx: partnerIdx,
                value: fields[partnerIdx].name
              },
              ...(altIdx > -1
                ? {
                    altitude: {
                      fieldIdx: altIdx,
                      value: fields[altIdx].name
                    }
                  }
                : {})
            },
            suffix: suffixPair
          });
          return carry;
        }
      }
    }
    return carry;
  }, acc);
}

/**
 *
 * @param dataset
 * @param column
 * @param mode
 * @type
 */
export function sortDatasetByColumn(
  dataset: KeplerTable<Field>,
  column: string,
  mode?: string
): KeplerTable<Field> {
  const {allIndexes, fields, dataContainer} = dataset;
  const fieldIndex = fields.findIndex(f => f.name === column);
  if (fieldIndex < 0) {
    return dataset;
  }

  const sortBy = SORT_ORDER[mode || ''] || SORT_ORDER.ASCENDING;

  if (sortBy === SORT_ORDER.UNSORT) {
    dataset.sortColumn = {};
    dataset.sortOrder = null;

    return dataset;
  }

  const sortFunction = sortBy === SORT_ORDER.ASCENDING ? ascending : descending;
  const sortOrder = allIndexes.slice().sort((a, b) => {
    const value1 = dataContainer.valueAt(a, fieldIndex);
    const value2 = dataContainer.valueAt(b, fieldIndex);
    if (!notNullorUndefined(value1) && notNullorUndefined(value2)) {
      return 1;
    } else if (notNullorUndefined(value1) && !notNullorUndefined(value2)) {
      return -1;
    }
    return sortFunction(value1, value2);
  });

  dataset.sortColumn = {
    [column]: sortBy
  };
  dataset.sortOrder = sortOrder;

  return dataset;
}

export function pinTableColumns(dataset: KeplerTable<Field>, column: string): KeplerTable<Field> {
  const field = dataset.getColumnField(column);
  if (!field) {
    return dataset;
  }

  let pinnedColumns;
  if (Array.isArray(dataset.pinnedColumns) && dataset.pinnedColumns.includes(field.name)) {
    // unpin it
    pinnedColumns = dataset.pinnedColumns.filter(co => co !== field.name);
  } else {
    pinnedColumns = (dataset.pinnedColumns || []).concat(field.name);
  }

  // @ts-ignore
  return copyTableAndUpdate(dataset, {pinnedColumns});
}

export function copyTable(original: KeplerTable<Field>): KeplerTable<Field> {
  return Object.assign(Object.create(Object.getPrototypeOf(original)), original);
}

/**
 * @type
 * @returns
 */
export function copyTableAndUpdate(
  original: KeplerTable<Field>,
  options: Partial<KeplerTable<Field>> = {}
): KeplerTable<Field> {
  return Object.entries(options).reduce((acc, entry) => {
    acc[entry[0]] = entry[1];
    return acc;
  }, copyTable(original));
}

export function getFieldValueAccessor<
  F extends {
    type?: Field['type'];
    format?: Field['format'];
  }
>(f: F, i: number, dc: DataContainerInterface) {
  return maybeToDate.bind(
    null,
    // is time
    f.type === ALL_FIELD_TYPES.timestamp,
    i,
    f.format || '',
    dc
  );
}

export default KeplerTable;
