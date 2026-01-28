import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.model.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken";

const generateAccessAndRefreshTokens = async (userId) => {
  try {
    const user = await User.findById(userId);
    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    user.refreshToken = refreshToken;
    await user.save({ validateBeforeSave: false });

    return { accessToken, refreshToken };
  } catch (error) {
    throw new ApiError(
      "Something went wrong while generating access and refresh tokens",
      500
    );
  }
};

const registerUser = asyncHandler(async (req, res) => {
  // get user details from frontend
  // validation - not empty
  // check if user already exists: username or email
  // check for images, check for avatar
  // upload image to cloudinary, avatar
  // create user object - create entry in db
  // remove password and refresh token field from response
  // check for user creation
  // return response

  const { fullName, email, username, password } = req.body;
  // console.log("email: ", email);

  // if (fullName === "") {
  //   throw new ApiError("fullName is required", 400);
  // }

  if (
    [fullName, email, username, password].some((field) => field?.trim() === "")
  ) {
    throw new ApiError("All fields are required", 400);
  }

  const existedUser = await User.findOne({
    $or: [{ username }, { email }],
  });

  if (existedUser) {
    throw new ApiError("User already exists with this username or email", 409);
  }
  // console.log(req.files);

  const avatarLocalPath = req.files?.avatar[0]?.path;
  // const coverImageLocalPath = req.files?.coverImage[0]?.path;

  let coverImageLocalPath;
  if (
    req.files &&
    Array.isArray(req.files.coverImage) &&
    req.files.coverImage.length > 0
  ) {
    coverImageLocalPath = req.files.coverImage[0].path;
  }

  if (!avatarLocalPath) {
    throw new ApiError("Avatar image is required", 400);
  }

  const avatar = await uploadOnCloudinary(avatarLocalPath);
  const coverImage = await uploadOnCloudinary(coverImageLocalPath);

  if (!avatar) {
    throw new ApiError(400, "Avatar file is required");
  }

  const user = await User.create({
    fullName,
    avatar: avatar.url,
    coverImage: coverImage?.url || "",
    email,
    username: username.toLowerCase(),
    password,
  });

  const createdUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );

  if (!createdUser) {
    throw new ApiError("User creation failed", 500);
  }

  return res
    .status(201)
    .json(new ApiResponse(200, createdUser, "User registered successfully"));
});

const loginUser = asyncHandler(async (req, res) => {
  // req body -> data
  // username or email
  // find the user
  // password check
  // access and refresh token
  // send cookie

  const { email, username, password } = req.body;
  if (!username && !email) {
    throw new ApiError("Username or email is required", 400);
  }

  const user = await User.findOne({
    $or: [{ username }, { email }],
  });

  if (!user) {
    throw new ApiError("User not found", 404);
  }

  const isPasswordValid = await user.isPasswordCorrect(password);

  if (!isPasswordValid) {
    throw new ApiError("Invalid user credentials", 401);
  }

  const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(
    user._id
  );

  const loggedInUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );

  // const options = {
  //   httpOnly: true,
  //   secure: true,
  // }
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production", // ⭐ key fix
    sameSite: "lax",
  };

  return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
      new ApiResponse(
        200,
        {
          user: loggedInUser,
          accessToken,
          refreshToken,
        },
        "User logged in successfully"
      )
    );
});

const logoutUser = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(
    req.user._id,
    {
      $set: {
        refreshToken: undefined,
      },
    },
    {
      new: true,
    }
  );

  // const options = {
  //   httpOnly: true,
  //   secure: true
  // }
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production", // ⭐ key fix
    sameSite: "lax",
  };

  return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(new ApiResponse(200, {}, "User logged out successfully"));
});

const refreshAccessToken = asyncHandler(async (req, res) => {
  const incomingRefreshToken =
    req.cookies.refreshToken || req.body.refreshToken;

  if (incomingRefreshToken) {
    throw new ApiError("Unauthorized request", 401);
  }

  try {
    const decodedToken = jwt.verify(
    incomingRefreshToken, 
    process.env.REFRESH_TOKEN_SECRET
  );

  const user = await User.findById(decodedToken?._id)

  if (!user) {
    throw new ApiError("Invalid refresh token", 401);
  }

  if (incomingRefreshToken !== user?.refreshToken) {
    throw new ApiError("Refresh token is expired or used", 401);
  }

  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production", // ⭐ key fix
    sameSite: "lax",
  };

  const { accessToken, newRefreshToken } = await generateAccessAndRefreshTokens(user._id);

  return res
  .status(200)
  .cookie("accessToken", accessToken, options)
  .cookie("refreshToken", newRefreshToken, options)
  .json(
    new ApiResponse(
      200,
      {
        accessToken,
        refreshToken: newRefreshToken,
      },
      "Access token refreshed successfully"
    )
  )
  } catch (error) {
    throw new ApiError(error?.message || "Invalid refresh token", 401);
  }


});

export { registerUser, loginUser, logoutUser, refreshAccessToken };
