// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project

import test from 'tape';
import cloneDeep from 'lodash/cloneDeep';
import {processCsvData, processGeojson} from '@kepler.gl/processors';
import {LayerClasses, KeplerGlLayers} from '@kepler.gl/layers';
import {GEOJSON_FIELDS} from '@kepler.gl/constants';
import {findDefaultLayer, getLayerHoverProp, getLayerOrderFromLayers} from '@kepler.gl/reducers';
import {StateWTripGeojson, StateWFiles} from 'test/helpers/mock-state';

const {PointLayer, ArcLayer, GeojsonLayer, LineLayer} = KeplerGlLayers;

import {wktCsv} from 'test/fixtures/test-csv-data';
import {cmpLayers} from 'test/helpers/comparison-utils';
import {getNextColorMakerValue} from 'test/helpers/layer-utils';
import {createNewDataEntryMock} from 'test/helpers/table-utils';
import tripGeojson, {timeStampDomain, tripBounds} from 'test/fixtures/trip-geojson';
import {geoJsonWithStyle} from 'test/fixtures/geojson';
import {KeplerTable, findPointFieldPairs} from '@kepler.gl/table';
import {createDataContainer} from '@kepler.gl/utils';

test('layerUtils -> findDefaultLayer.1', t => {
  const inputFields = [
    // layer 1
    {
      name: 'one_lat',
      fieldIdx: 0
    },
    {
      name: 'one_lng',
      fieldIdx: 1
    },
    // layer 2
    {
      name: 'two_two.lng',
      fieldIdx: 2
    },
    {
      name: 'two_two.lat',
      fieldIdx: 3
    },
    // layer 3
    {
      name: 'three longitude',
      fieldIdx: 4
    },
    {
      name: 'three latitude',
      fieldIdx: 5
    },
    // layer 4
    {
      name: 'four._.lon',
      fieldIdx: 6
    },
    {
      name: 'four._.lat',
      fieldIdx: 7
    },
    // layer 5
    {
      name: 'lat',
      fieldIdx: 8
    },
    {
      name: 'lon',
      fieldIdx: 9
    },
    // non layer
    //

    {
      name: 'non_layer_longitude.alt',
      fieldIdx: 10
    },
    {
      name: 'non_layer_latitude.alt',
      fieldIdx: 11
    },
    {
      name: 'non_layer_altitude.alt',
      fieldIdx: 12
    }
  ];

  const dataId = 'testtest';

  const outputLayers = [
    new PointLayer({
      label: 'one',
      dataId,
      columns: {
        lat: {
          value: 'one_lat',
          fieldIdx: 0
        },
        lng: {
          value: 'one_lng',
          fieldIdx: 1
        },
        altitude: {
          value: null,
          fieldIdx: -1,
          optional: true
        }
      }
    }),
    new PointLayer({
      label: 'two_two',
      dataId,
      columns: {
        lat: {
          value: 'two_two.lat',
          fieldIdx: 3
        },
        lng: {
          value: 'two_two.lng',
          fieldIdx: 2
        },
        altitude: {
          value: null,
          fieldIdx: -1,
          optional: true
        }
      }
    }),
    new PointLayer({
      label: 'three',
      dataId,
      columns: {
        lat: {
          value: 'three latitude',
          fieldIdx: 5
        },
        lng: {
          value: 'three longitude',
          fieldIdx: 4
        },
        altitude: {
          value: null,
          fieldIdx: -1,
          optional: true
        }
      }
    }),
    new PointLayer({
      label: 'four._',
      dataId,
      columns: {
        lat: {
          value: 'four._.lat',
          fieldIdx: 7
        },
        lng: {
          value: 'four._.lon',
          fieldIdx: 6
        },
        altitude: {
          value: null,
          fieldIdx: -1,
          optional: true
        }
      }
    }),
    new PointLayer({
      label: 'point',
      dataId,
      columns: {
        lat: {
          value: 'lat',
          fieldIdx: 8
        },
        lng: {
          value: 'lon',
          fieldIdx: 9
        },
        altitude: {
          value: null,
          fieldIdx: -1,
          optional: true
        }
      }
    }),
    new PointLayer({
      label: 'non_layeralt',
      dataId,
      columns: {
        lat: {
          value: 'non_layer_latitude.alt',
          fieldIdx: 11
        },
        lng: {
          value: 'non_layer_longitude.alt',
          fieldIdx: 10
        },
        altitude: {
          value: 'non_layer_altitude.alt',
          fieldIdx: 12,
          optional: true
        }
      }
    }),
    new ArcLayer({
      label: 'one -> two_two arc',
      dataId,
      isVisible: false,
      columns: {
        lat0: {
          value: 'one_lat',
          fieldIdx: 0
        },
        lng0: {
          value: 'one_lng',
          fieldIdx: 1
        },
        lat1: {
          value: 'two_two.lat',
          fieldIdx: 3
        },
        lng1: {
          value: 'two_two.lng',
          fieldIdx: 2
        }
      }
    }),
    new LineLayer({
      label: 'one -> two_two line',
      dataId,
      isVisible: false,
      columns: {
        lat0: {
          value: 'one_lat',
          fieldIdx: 0
        },
        lng0: {
          value: 'one_lng',
          fieldIdx: 1
        },
        lat1: {
          value: 'two_two.lat',
          fieldIdx: 3
        },
        lng1: {
          value: 'two_two.lng',
          fieldIdx: 2
        },
        alt0: {
          value: null,
          fieldIdx: -1,
          optional: true
        },
        alt1: {
          value: null,
          fieldIdx: -1,
          optional: true
        }
      }
    })
  ];

  const fieldPairs = findPointFieldPairs(inputFields);
  const layers = findDefaultLayer({fields: inputFields, fieldPairs, id: dataId}, LayerClasses);

  t.equal(layers.length, outputLayers.length, 'number of layers found');

  layers.forEach((l, i) => cmpLayers(t, outputLayers[i], l));

  t.end();
});

test('layerUtils -> findDefaultLayer.2', t => {
  const inputFields = [
    // layer 1
    {
      name: 'all_points',
      fieldIdx: 0
    }
  ];
  const dataId = 'milkshake';

  const dataset = new KeplerTable({
    info: {
      id: dataId,
      label: 'sf_zip_geo'
    }
  });
  dataset.importData({
    data: {
      rows: [
        [
          {
            type: 'Feature',
            properties: {index: 0},
            geometry: {type: 'Point', coordinates: []}
          }
        ],
        [
          {
            type: 'Feature',
            properties: {index: 1},
            geometry: {type: 'Point', coordinates: []}
          }
        ]
      ],
      fields: inputFields
    }
  });

  const expected = new GeojsonLayer({
    label: 'sf_zip_geo',
    isVisible: true,
    dataId,
    columns: {
      geojson: {
        value: 'all_points',
        fieldIdx: 0
      }
    }
  });

  expected.updateLayerVisConfig({filled: true, stroked: false});

  const layers = findDefaultLayer(dataset, LayerClasses);

  t.equal(layers.length, 1, 'number of layers found');
  cmpLayers(t, expected, layers[0]);

  t.end();
});

test('layerUtils -> findDefaultLayer.3', t => {
  const dataId = 'cool';

  const inputFields = [
    // layer 1 & 2
    {
      name: 'begintrip_lat',
      fieldIdx: 0
    },
    {
      name: 'begintrip_lng',
      fieldIdx: 1
    }
  ];

  const outputLayers = [
    new PointLayer({
      label: 'begintrip',
      dataId,
      columns: {
        lat: {
          value: 'begintrip_lat',
          fieldIdx: 0
        },
        lng: {
          value: 'begintrip_lng',
          fieldIdx: 1
        },
        altitude: {
          value: null,
          fieldIdx: -1,
          optional: true
        }
      }
    })
  ];

  const fieldPairs = findPointFieldPairs(inputFields);
  const layers = findDefaultLayer({fields: inputFields, fieldPairs, id: dataId}, LayerClasses);

  t.equal(layers.length, 1, 'number of layers found');
  layers.forEach((l, i) => cmpLayers(t, outputLayers[i], l));

  t.end();
});

test('layerUtils -> findDefaultLayer.4', t => {
  // Since all defaults layers are scanned and they
  // share field names or patterns.  This set produces
  // multiple layers.
  // Order determined by the order
  // the defaults are scanned inside the function under test.
  const inputFields = [
    // layer 1 (grid), 2 (arc), 3 (point)
    {
      name: 'begintrip_lat',
      fieldIdx: 0
    },
    {
      name: 'begintrip_lng',
      fieldIdx: 1
    },
    // layer 2 (arc), 4 (point)
    {
      name: 'dropoff_lat',
      fieldIdx: 2
    },
    {
      name: 'dropoff_lng',
      fieldIdx: 3
    }
  ];

  const dataId = 'yololo';
  const outputLayers = [
    new PointLayer({
      label: 'begintrip',
      dataId,
      columns: {
        lat: {
          value: 'begintrip_lat',
          fieldIdx: 0
        },
        lng: {
          value: 'begintrip_lng',
          fieldIdx: 1
        },
        altitude: {
          value: null,
          fieldIdx: -1,
          optional: true
        }
      }
    }),
    new PointLayer({
      label: 'dropoff',
      dataId,
      columns: {
        lat: {
          value: 'dropoff_lat',
          fieldIdx: 2
        },
        lng: {
          value: 'dropoff_lng',
          fieldIdx: 3
        },
        altitude: {
          value: null,
          fieldIdx: -1,
          optional: true
        }
      }
    }),
    new ArcLayer({
      label: 'begintrip -> dropoff arc',
      dataId,
      isVisible: false,
      columns: {
        lat0: {
          value: 'begintrip_lat',
          fieldIdx: 0
        },
        lng0: {
          value: 'begintrip_lng',
          fieldIdx: 1
        },
        lat1: {
          value: 'dropoff_lat',
          fieldIdx: 2
        },
        lng1: {
          value: 'dropoff_lng',
          fieldIdx: 3
        }
      }
    }),
    new LineLayer({
      label: 'begintrip -> dropoff line',
      dataId,
      isVisible: false,
      columns: {
        lat0: {
          value: 'begintrip_lat',
          fieldIdx: 0
        },
        lng0: {
          value: 'begintrip_lng',
          fieldIdx: 1
        },
        lat1: {
          value: 'dropoff_lat',
          fieldIdx: 2
        },
        lng1: {
          value: 'dropoff_lng',
          fieldIdx: 3
        },
        alt0: {
          value: null,
          fieldIdx: -1,
          optional: true
        },
        alt1: {
          value: null,
          fieldIdx: -1,
          optional: true
        }
      }
    })
  ];

  const fieldPairs = findPointFieldPairs(inputFields);
  const layers = findDefaultLayer({fields: inputFields, fieldPairs, id: dataId}, LayerClasses);

  t.equal(layers.length, outputLayers.length, 'number of layers found');
  layers.forEach((l, i) => cmpLayers(t, outputLayers[i], l));

  t.end();
});

test('layerUtils -> findDefaultLayer.5', t => {
  const inputFields = [
    // layer 1
    {
      name: 'one_late',
      fieldIdx: 0
    },
    {
      name: 'one_lng',
      fieldIdx: 1
    }
  ];

  const fieldPairs = findPointFieldPairs(inputFields);
  const layers = findDefaultLayer({fields: inputFields, fieldPairs, id: 'yo'}, LayerClasses);

  t.equal(layers.length, 0, 'number of layers found');

  t.end();
});

test('layerUtils -> findDefaultLayer:GeojsonLayer', t => {
  const dataset = new KeplerTable({
    info: {
      label: 'sf_zip_geo'
    }
  });
  dataset.importData({
    data: {
      rows: [
        [
          {
            type: 'Feature',
            properties: {index: 0},
            geometry: {type: 'Point', coordinates: []}
          }
        ],
        [
          {
            type: 'Feature',
            properties: {index: 1},
            geometry: {type: 'Point', coordinates: []}
          }
        ]
      ],
      fields: [
        {
          name: 'random'
        },
        {
          name: 'begintrip_lng'
        },
        {
          name: 'cool'
        },
        {
          name: 'dropoff_lng'
        },
        {
          name: GEOJSON_FIELDS.geojson[0]
        },
        {
          name: GEOJSON_FIELDS.geojson[1]
        }
      ]
    }
  });

  const expected1 = new GeojsonLayer({
    label: 'what',
    dataId: 'smoothie',
    isVisible: true,
    columns: {
      geojson: {value: GEOJSON_FIELDS.geojson[0], fieldIdx: 4}
    }
  });

  const expected2 = new GeojsonLayer({
    label: 'what',
    dataId: 'smoothie',
    isVisible: true,
    columns: {
      geojson: {value: GEOJSON_FIELDS.geojson[1], fieldIdx: 5}
    }
  });

  // eslint-disable-next-line no-unused-vars
  const [_layer1Color, _layer2Color, layer2Stroke] = getNextColorMakerValue(3);
  expected1.updateLayerVisConfig({filled: true, stroked: false});
  expected2.updateLayerVisConfig({
    filled: true,
    stroked: true,
    strokeColor: layer2Stroke
  });

  const {fields} = dataset;

  const dataContainer = createDataContainer([
    [
      0,
      1,
      2,
      3,
      {
        type: 'Feature',
        properties: {index: 0},
        geometry: {type: 'Point', coordinates: []}
      },
      {
        type: 'Feature',
        properties: {index: 0},
        geometry: {type: 'Polygon', coordinates: []}
      }
    ],
    {fields}
  ]);

  const geojsonLayers = findDefaultLayer(
    {
      fields,
      label: 'what',
      id: 'smoothie',
      fieldPairs: [],
      dataContainer
    },
    LayerClasses
  );

  cmpLayers(t, [expected1, expected2], geojsonLayers);
  t.end();
});

test('layerUtils -> findDefaultLayer:GeojsonLayer.wkt', t => {
  const {fields, rows} = processCsvData(wktCsv);

  const dataId = '0dj3h';
  const label = 'some geometry file';

  const expected1 = new GeojsonLayer({
    dataId: '0dj3h',
    label: 'some geometry file',
    isVisible: true,
    columns: {
      geojson: {value: 'simplified_shape_v2', fieldIdx: 1}
    }
  });
  const expected2 = new GeojsonLayer({
    dataId: '0dj3h',
    label: 'some geometry file',
    isVisible: true,
    columns: {
      geojson: {value: 'simplified_shape', fieldIdx: 2}
    }
  });

  const [_layer1Color, strokeColor1, _layer2Color, strokeColor2] = getNextColorMakerValue(4);
  expected1.updateLayerVisConfig({
    filled: true,
    stroked: true,
    strokeColor: strokeColor1
  });
  expected2.updateLayerVisConfig({
    filled: true,
    stroked: true,
    strokeColor: strokeColor2
  });

  const dataContainer = createDataContainer(rows, {fields});

  const geojsonLayers = findDefaultLayer(
    {fields, id: dataId, label, fieldPairs: [], dataContainer},
    LayerClasses
  );

  cmpLayers(t, [expected1, expected2], geojsonLayers);
  t.end();
});

test('layerUtils -> findDefaultLayer:GeojsonWithStyle', t => {
  const {fields, rows} = processGeojson(geoJsonWithStyle);

  const dataContainer = createDataContainer(rows, {fields});

  const geojsonLayers = findDefaultLayer(
    {
      fields,
      id: 'test',
      dataId: 'taro',
      label: 'chubby prince',
      fieldPairs: [],
      dataContainer
    },
    LayerClasses
  );

  t.equal(geojsonLayers.length, 1, 'should find 1 layer');
  t.end();
});

test('layerUtils -> findDefaultLayer:IconLayer', t => {
  const inputFields = [
    {
      name: 'begintrip_lat',
      fieldIdx: 0
    },
    {
      name: 'begintrip_lng',
      fieldIdx: 1
    },
    {
      name: 'dropoff_lat',
      fieldIdx: 2
    },
    {
      name: 'dropoff_lng',
      fieldIdx: 3
    }
  ];
  const fieldPairs = findPointFieldPairs(inputFields);

  const eventIcon = [{name: 'event_icon', fieldIdx: 4}];
  const nameIcon = [{name: 'name.icon', fieldIdx: 4}];

  t.equal(
    findDefaultLayer(
      {
        fields: inputFields,
        fieldPairs,
        id: 'meow',
        allData: []
      },
      LayerClasses
    ).filter(l => l.type === 'icon').length,
    0,
    'should find no icon layer'
  );

  const fieldsWithIcon = [...inputFields, ...eventIcon];
  const fieldPairsWIcon = findPointFieldPairs(fieldsWithIcon);

  let iconLayers = findDefaultLayer(
    {
      fields: fieldsWithIcon,
      fieldPairs: fieldPairsWIcon,
      id: 'meow'
    },
    LayerClasses
  ).filter(l => l.type === 'icon');

  t.equal(iconLayers.length, 1, 'should find 1 icon layer');
  t.equal(iconLayers[0].config.label, 'event icon', 'should find 1 icon layer');

  const fieldsWith2Icon = [...inputFields, ...nameIcon, ...eventIcon];
  const fieldPairsW2Icon = findPointFieldPairs(fieldsWith2Icon);

  iconLayers = findDefaultLayer(
    {
      fields: fieldsWith2Icon,
      fieldPairs: fieldPairsW2Icon,
      id: 'meow'
    },
    LayerClasses
  ).filter(l => l.type === 'icon');

  t.equal(iconLayers.length, 2, 'should find 2 icon layers');
  t.equal(iconLayers[0].config.label, 'name icon', 'should find 2 icon layer');

  t.end();
});

test('layerUtils -> findDefaultLayer: TripLayer', t => {
  const stateWTrip = StateWTripGeojson;
  t.equal(stateWTrip.visState.layers.length, 1, 'should find one layer');
  const foundLayer = stateWTrip.visState.layers[0];
  t.equal(foundLayer.type, 'trip', 'should find a trip layer');

  const expectedConfig = {
    dataId: 'trip_data',
    label: 'Trip Data',
    columns: {
      geojson: {value: '_geojson', fieldIdx: 0},
      id: {value: null, fieldIdx: -1},
      lat: {value: null, fieldIdx: -1},
      lng: {value: null, fieldIdx: -1},
      timestamp: {value: null, fieldIdx: -1},
      altitude: {value: null, fieldIdx: -1, optional: true}
    },
    isVisible: true,
    columnMode: 'geojson',
    animation: {enabled: true, domain: timeStampDomain}
  };

  Object.keys(expectedConfig).forEach(key => {
    t.deepEqual(
      foundLayer.config[key],
      expectedConfig[key],
      `should set correct config.${key} domain`
    );
  });

  t.deepEqual(foundLayer.meta.bounds, tripBounds, 'should set correct bounds');
  t.deepEqual(foundLayer.meta.featureTypes, {line: true}, 'should set correct bounds');

  t.end();
});

test('layerUtils -> findDefaultLayer: TripLayer.1 -> no ts', async t => {
  // change 3rd coordinate to string
  const modified = tripGeojson.features.map(f => ({
    ...f,
    geometry: {
      ...f.geometry,
      coordinates: f.geometry.coordinates.map(coord => [...coord.slice(0, 3), 'hello'])
    }
  }));

  const noTripGeojson = {
    type: 'FeatureCollection',
    features: modified
  };

  const dataset = await createNewDataEntryMock({
    info: {id: 'taro'},
    data: processGeojson(noTripGeojson)
  });

  const layers = findDefaultLayer(dataset.taro, LayerClasses);

  t.equal(layers.length, 1, 'should find 1 layer');
  const foundLayer = layers[0];
  t.equal(foundLayer.type, 'geojson', 'should find a geojson layer');
  t.end();
});

test('layerUtils -> findDefaultLayer: TripLayer.1 -> ts as string', async t => {
  const tripData = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [-73.78966, 40.6429, 0, '2018-09-01 11:00'],
            [-73.7895, 40.64267, 0, '2018-09-01 11:01'],
            [-73.78923, 40.6424, 0, '2018-09-01 11:02'],
            [-73.78905, 40.64222, 0, '2018-09-01 11:03']
          ]
        }
      }
    ]
  };

  const dataset = await createNewDataEntryMock({
    info: {id: 'taro'},
    data: processGeojson(tripData)
  });

  const layers = findDefaultLayer(dataset.taro, LayerClasses);

  t.equal(layers.length, 1, 'should find 1 layer');
  const foundLayer = layers[0];
  t.equal(foundLayer.type, 'trip', 'should find a geojson layer');

  t.deepEqual(
    foundLayer.config.animation,
    {enabled: true, domain: [1535799600000, 1535799780000]},
    'should set correct animation domain'
  );
  t.end();
});

test('layerUtils -> getLayerHoverProp', t => {
  const visState = cloneDeep(StateWFiles).visState;
  const layer = visState.layers[0];
  const layerData = visState.layerData[0];
  const layersToRender = {
    [layer.id]: layer
  };

  const obj = layerData.data[0];

  const mockHoverInfo = {
    object: obj,
    picked: true,
    layer: {
      props: {
        idx: 0
      }
    }
  };
  const mockHoverInfoNotHovered = {
    picked: false,
    object: null
  };
  const args = {
    animationConfig: visState.animationConfig,
    interactionConfig: visState.interactionConfig,
    hoverInfo: mockHoverInfo,
    layers: visState.layers,
    layersToRender,
    datasets: visState.datasets
  };

  const expectedDataset = visState.datasets[layer.config.dataId];
  const expected = {
    data: expectedDataset.dataContainer.row(obj.index),
    fields: expectedDataset.fields,
    fieldsToShow: visState.interactionConfig.tooltip.config.fieldsToShow[layer.config.dataId],
    layer,
    currentTime: visState.animationConfig.currentTime
  };

  t.deepEqual(getLayerHoverProp(args), expected, 'should get correct layerHoverProp');

  args.hoverInfo = mockHoverInfoNotHovered;
  t.deepEqual(getLayerHoverProp(args), null, 'should get correct layerHoverProp');

  visState.interactionConfig.tooltip.enabled = false;
  args.hoverInfo = mockHoverInfo;

  t.deepEqual(getLayerHoverProp(args), null, 'should get correct layerHoverProp');

  t.end();
});

test('layerUtils -> getLayerOrderFromLayers', t => {
  const visState = cloneDeep(StateWFiles).visState;
  const layerOrder = getLayerOrderFromLayers(visState.layers);

  t.deepEqual(layerOrder, ['point-0', 'geojson-1'], 'Should generate layerOrder correctly');
  t.end();
});
