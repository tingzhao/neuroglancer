/**
 * @license
 * This work is a derivative of the Google Neuroglancer project,
 * Copyright 2016 Google Inc.
 * The Derivative Work is covered by
 * Copyright 2019 Howard Hughes Medical Institute
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {verifyObject, verifyObjectProperty, verifyString, parseIntVec} from 'neuroglancer/util/json';
import {vec3} from 'neuroglancer/util/geom';
import {PointAnnotation, LineAnnotation, defaultJsonSchema, AnnotationFacade} from 'neuroglancer/datasource/flyem/annotation';
import { AnnotationType } from 'neuroglancer/annotation';

export type ClioPointAnnotation = PointAnnotation;
export type ClioLineAnnotation = LineAnnotation;

export type ClioAnnotation = ClioPointAnnotation | ClioLineAnnotation;
export class ClioAnnotationFacade extends AnnotationFacade {
  get title() {
    return this.annotation.ext && this.annotation.ext.title;
  }

  set title(title: string) {
    this.ext.title =title;
  }

  get description() {
    return this.annotation.ext && this.annotation.ext.description;
  }

  set description(value: string) {
    this.ext.description = value;
  }

  get user() {
    return this.annotation.ext && this.annotation.ext.user;
  }

  set user(value: string) {
    this.ext.user = value;
  }
};

export function parseDescription(description: string)
{
  let match = description.match(/^\${(.*):JSON}$/);
  if (match) {
    return JSON.parse(match[1]);
  } else {
    return null;
  }
}

export abstract class AnnotationRequestHelper<T> {
  constructor(public sendingToServer: Boolean) {}
  uploadable(_: T|string) {
    return this.sendingToServer;
  }
  abstract encode(annotation: T): {[key: string]: any}|null;
  abstract decode(key: string, entry: {[key: string]: any}): T|null;
}

function decodeAnnotationPropV2(entry: {[key: string]: any}, out: ClioAnnotation) {
  const annotationRef = new ClioAnnotationFacade(out);

  if ('prop' in entry) {
    annotationRef.prop = verifyObjectProperty(entry, 'prop', verifyObject);
  }

  if (entry.description) {
    annotationRef.description = verifyObjectProperty(entry, 'description', verifyString);
  }

  if (entry.title) {
    annotationRef.title = verifyObjectProperty(entry, 'title', verifyString);
  }

  if (entry.user) {
    annotationRef.user = verifyObjectProperty(entry, 'user', verifyString);
  }

  annotationRef.update();
}

export class V1PointAnnotationRequestHelper extends AnnotationRequestHelper<ClioPointAnnotation> {
  private getPositionFromKey(key: string) {
    if (key) {
      let pos = key.split('_').map(x=>+x);
      if (pos.length === 3) {
        return vec3.fromValues(pos[0], pos[1], pos[2]);
      }
    }

    return null;
  }

  encode(annotation: ClioPointAnnotation): {[key: string]: any}|null {
    let obj: { [key: string]: any } = {
      Kind: annotation.kind, //todo: might not be necessary
    };

    let annotationRef = new ClioAnnotationFacade(annotation);

    if (annotationRef.presentation !== undefined) {
      obj.description = annotationRef.presentation;
    } else if (annotation.kind === 'Atlas') {
      obj.description = '';
    }

    if (annotationRef.title !== undefined) {
      obj.title = annotationRef.title;
    }

    obj.user = annotationRef.user;

    if (annotation.prop) {
      let prop = { ...annotation.prop };
      delete prop.comment;
      delete prop.user;
      delete prop.title;
      if (prop) {
        obj.Prop = prop;
      }
    }

    return obj;
  }

  decode(key: string, entry: { [key: string]: any }): ClioPointAnnotation | null {
    try {
      const kind = verifyObjectProperty(entry, 'Kind', verifyString);
      let prop: { [key: string]: string } = {};
      let corner = this.getPositionFromKey(key);
      if (!corner) {
        const posKey = ('location' in entry) ? 'location' : 'Pos';
        corner = verifyObjectProperty(entry, posKey, x => parseIntVec(vec3.create(), x));
      }
      if ('Prop' in entry) {
        prop = verifyObjectProperty(entry, 'Prop', verifyObject);
      }

      let description = '';
      if ('description' in entry) {
        description = verifyObjectProperty(entry, 'description', verifyString);
      }

      let title = '';
      if ('title' in entry) {
        title = verifyObjectProperty(entry, 'title', verifyString);
      }

      let user = '';
      if ('user' in entry) {
        user = verifyObjectProperty(entry, 'user', verifyString);
      }

      let annotation: ClioPointAnnotation = {
        point: corner,
        type: AnnotationType.POINT,
        properties: [],
        kind,
        id: `${corner[0]}_${corner[1]}_${corner[2]}`,
        prop: {}
      };

      let annotationRef = new ClioAnnotationFacade(annotation);
      annotationRef.prop = prop;

      if (description) {
        annotationRef.presentation = description;
      }

      if (title) {
        annotationRef.title = title;
      }

      if (user) {
        annotationRef.user = user;
      }

      annotationRef.update();

      return annotation;
    } catch (e) {
      console.log(e);
      return null;
    }
  }
}

export class V2PointAnnotationRequestHelper extends AnnotationRequestHelper<ClioPointAnnotation> {
  defaultKind = 'Normal';

  encode(annotation: ClioPointAnnotation): { [key: string]: any } | null {
    const annotationRef = new ClioAnnotationFacade(annotation);
    if (!annotationRef.user) {
      return null;
    }

    let obj: { [key: string]: any } = {
      tags: []
    };

    obj.description = annotationRef.description;
    obj.user = annotationRef.user;

    if (annotationRef.title !== undefined) {
      obj.title = annotationRef.title;
    }

    obj.prop = { ...annotation.prop };

    obj.kind = 'point';
    obj.pos = [annotation.point[0], annotation.point[1], annotation.point[2]];

    return obj;
  }

  decode(key: string, entry: { [key: string]: any }): ClioPointAnnotation | null {
    try {
      if (verifyObjectProperty(entry, 'kind', verifyString) !== 'point') {
        throw new Error('Invalid kind for point annotation data.');
      }

      const point = verifyObjectProperty(entry, 'pos', x => parseIntVec(new Float32Array(3), x));

      const annotation: ClioPointAnnotation = {
        id: key,
        type: AnnotationType.POINT,
        kind: this.defaultKind,
        point,
        properties: []
      };

      decodeAnnotationPropV2(entry, annotation);

      return annotation;
    } catch (e) {
      console.log(e);
      return null;
    }
  }
}

/*
export class V2LineAnnotationRequestHelper extends AnnotationRequestHelper<ClioPointAnnotation> {
  encode(annotation: ClioPointAnnotation): { [key: string]: any } | null {
    const annotationRef = new ClioAnnotationFacade(annotation);
    if (!annotationRef.user) {
      return null;
    }

    let obj: { [key: string]: any } = {
      tags: []
    };

    obj.description = annotationRef.description;
    obj.user = annotationRef.user;

    if (annotationRef.title !== undefined) {
      obj.title = annotationRef.title;
    }

    obj.prop = { ...annotation.prop };

    obj.kind = 'point';
    obj.pos = [annotation.point[0], annotation.point[1], annotation.point[2]];

    return obj;
  }

  decode(key: string, entry: { [key: string]: any }): ClioPointAnnotation | null {
    try {
      if (verifyObjectProperty(entry, 'kind', verifyString) !== 'point') {
        throw new Error('Invalid kind for point annotation data.');
      }

      const point = verifyObjectProperty(entry, 'pos', x => parseIntVec(new Float32Array(3), x));

      const annotation: ClioPointAnnotation = {
        id: key,
        type: AnnotationType.POINT,
        kind: this.defaultKind,
        point,
        properties: []
      };

      decodeAnnotationPropV2(entry, annotation);

      return annotation;
    } catch (e) {
      console.log(e);
      return null;
    }
  }
}
*/

export class V2AtlasAnnotationRequestHelper extends V2PointAnnotationRequestHelper {
  defaultKind = 'Atlas';
  uploadable(annotation: ClioPointAnnotation|string) {
    if (super.uploadable(annotation)) {
      if (typeof annotation !== 'string') {
        const annotationRef = new ClioAnnotationFacade(annotation);
        if (typeof annotationRef.title === 'string' && annotationRef.title.length > 0) {
          return true;
        }
      }
    }

    return false;
  }
}

export function makeAnnotationRequestHelpers(
  init: {
    [AnnotationType.POINT]: AnnotationRequestHelper<ClioPointAnnotation>|null|undefined,
    [AnnotationType.LINE]?: AnnotationRequestHelper<ClioLineAnnotation>|null
  }
) {
  const helpers: any = { ...init };
  if (init[AnnotationType.POINT]) {
    helpers.point = init[AnnotationType.POINT];
  }
  if (init[AnnotationType.LINE]) {
    helpers.lineseg = init[AnnotationType.LINE];
  }

  return helpers;
}

export function makeEncoders(api: string|undefined, kind: string|undefined) {
  if (api === 'v2') {
    if (kind === 'Atlas') {
      return makeAnnotationRequestHelpers({
        [AnnotationType.POINT]: new V2AtlasAnnotationRequestHelper(true)
      });
    } else {
      return makeAnnotationRequestHelpers({
        [AnnotationType.POINT]: new V2PointAnnotationRequestHelper(true)
      });
    }
  }

  return makeAnnotationRequestHelpers({
    [AnnotationType.POINT]: new V1PointAnnotationRequestHelper(true)
  });
}

export const defaultAnnotationSchema = defaultJsonSchema;

export const defaultAtlasSchema = {
  "definitions": {},
  "type": "object",
  "required": [
    "Prop"
  ],
  "properties": {
    "Prop": {
      "$id": "#/properties/Prop",
      "type": "object",
      "title": "Properties",
      "required": [
        "title", "description"
      ],
      "properties": {
        "title": {
          "$id": "#/properties/Prop/properties/title",
          "type": "string",
          "title": "Title",
          "default": ""
        },
        "description": {
          "$id": "#/properties/Prop/properties/description",
          "type": "string",
          "title": "Description",
          "default": ""
        }
      }
    }
  }
};

/*
export const defaultAtlasSchema = {
  "definitions": {},
  "type": "object",
  "required": [
    "Title", "Description"
  ],
  "properties": {
    "Title": {
      "$id": "#/properties/Title",
      "type": "string",
      "title": "Title",
      "default": ""
    },
    "Description": {
      "$id": "#/properties/Description",
      "type": "string",
      "title": "Description",
      "default": ""
    }
  }
};
*/