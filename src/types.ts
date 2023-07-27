export interface ActivityInterface {
  slack: string;
  activity: string;
}

export interface ModuleInfoInterface {
  lessonPlan: string;
  module: string;
  day: string;
}

export interface ResponseActionHandler {
  (module: ModuleInfoInterface, activities: ActivityInterface[]): any;
}

export interface ActionChoiceInterface {
  name: string;
  value: string;
  call: ResponseActionHandler;
}