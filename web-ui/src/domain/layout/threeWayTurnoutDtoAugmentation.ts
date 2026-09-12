import "./layoutDto.js";

declare module "./layoutDto.js" {
  interface TrackTurnoutThreeWayElementDto {
    leftMotor1Value?: boolean;
    leftMotor2Value?: boolean;
    straightMotor1Value?: boolean;
    straightMotor2Value?: boolean;
    rightMotor1Value?: boolean;
    rightMotor2Value?: boolean;
  }
}
