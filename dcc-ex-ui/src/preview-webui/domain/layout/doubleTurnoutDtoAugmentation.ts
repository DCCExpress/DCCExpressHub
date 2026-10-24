import "./layoutDto.js";

declare module "./layoutDto.js" {
  interface TrackTurnoutDoubleElementDto {
    ooMotor1Value?: boolean;
    ooMotor2Value?: boolean;
    ocMotor1Value?: boolean;
    ocMotor2Value?: boolean;
    coMotor1Value?: boolean;
    coMotor2Value?: boolean;
    ccMotor1Value?: boolean;
    ccMotor2Value?: boolean;
  }
}
